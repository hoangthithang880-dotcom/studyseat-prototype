"""Export only the current prototype assignment; never upload or mutate the source."""
from pathlib import Path
import argparse
import hashlib
import json
import shutil
import subprocess

ROOT_FILES = ['README.md', 'index.html', '.gitignore', '.nojekyll', 'package.json', 'pnpm-lock.yaml']
DIRECTORIES = ['deploy', 'prototype']
SCRIPTS = ['preview.py', 'build-prototype.py', 'version-assets.cjs', 'prepare-github.py']
DOCUMENTS = ['墨刀原型搭建与维护说明.md', '原型设计说明.md', '演示与提交说明.md', 'GitHub资料说明.md', '墨刀同步记录.md', 'prototype-release.json', 'prototype-browser-results.json', 'prototype-unit-results.txt']
SCREENSHOTS = ['local-final-login.png', 'local-room.png', 'local-booking.png', 'local-admin-rules.png', 'local-admin-closure.png', 'local-admin-logs.png', 'local-attendance.png', 'local-profile.png', 'modao-entry.png', 'modao-room.png']
OMIT_PARTS = {'.git', 'node_modules', '__pycache__', '.DS_Store', 'test-results', 'playwright-report'}


def selected_files(source):
    selected = list(ROOT_FILES)
    for directory in DIRECTORIES:
        selected += [str(p.relative_to(source)) for p in sorted((source / directory).rglob('*')) if p.is_file() and not set(p.relative_to(source).parts) & OMIT_PARTS]
    selected += ['scripts/' + n for n in SCRIPTS]
    selected += ['docs/' + n for n in DOCUMENTS]
    selected += ['docs/screenshots/' + n for n in SCREENSHOTS]
    selected += [str(p.relative_to(source)) for p in sorted((source / 'tests').glob('*.test.cjs'))]
    selected += ['tests/browser.cjs', 'tests/fixtures/blank-frame.html', 'modao/StudySeat_定版原型.html']
    return sorted(set(selected))


def git_state(source):
    try:
        commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True, stderr=subprocess.DEVNULL).strip()
        dirty = subprocess.check_output(['git', 'status', '--porcelain', '--', '.'], cwd=source, text=True, stderr=subprocess.DEVNULL).strip()
        return {'commit': commit, 'workingTreeClean': not bool(dirty)}
    except (OSError, subprocess.CalledProcessError):
        return {'commit': None, 'workingTreeClean': None}


def export(source, output):
    source, output = source.resolve(), output.resolve()
    if output == source or source in output.parents or output in source.parents:
        raise ValueError('目标必须是项目之外的新文件夹，不能覆盖源项目或其父目录。')
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise ValueError('目标已存在且非空，请选择新文件夹；不会覆盖。')
    files = selected_files(source)
    for name in files:
        if not (source / name).is_file():
            raise ValueError('缺少必要文件：' + name)
    output.mkdir(parents=True, exist_ok=True)
    manifest = {'project': 'Study Seat', 'scope': 'current prototype assignment only', 'source': git_state(source), 'prototypeRelease': json.loads((source / 'docs/prototype-release.json').read_text())['release'], 'files': []}
    for name in files:
        destination = output / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / name, destination)
        content = destination.read_bytes()
        manifest['files'].append({'path': Path(name).as_posix(), 'bytes': len(content), 'sha256': hashlib.sha256(content).hexdigest()})
    (output / 'SUBMISSION_MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(f'GitHub 资料已提取：{output}（{len(files) + 1} 个文件；没有推送或部署）')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    export(Path(__file__).resolve().parent.parent, args.output)


if __name__ == '__main__':
    main()
