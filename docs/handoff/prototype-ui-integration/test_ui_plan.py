"""Check the plan, its references, source boundaries, and rendered readability."""
import argparse
import json
from pathlib import Path
import subprocess
import unittest
from zipfile import ZipFile
import xml.etree.ElementTree as ET

from docx import Document

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
BASE = '2c24361f0cd05f306ea9cc01c129fb0410638424'
DOCX = HERE / 'StudySeat_原型界面接入与补充PR实施计划书.docx'
POPPLER = Path.home() / '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/poppler/bin'
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


class PlanTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.document = Document(DOCX)
        with ZipFile(DOCX) as package:
            assert package.testzip() is None
            cls.xml = ET.fromstring(package.read('word/document.xml'))
            cls.rels = ET.fromstring(package.read('word/_rels/document.xml.rels'))
        cls.text = ''.join(cls.xml.itertext())
        cls.task = (HERE / '新对话启动指令.txt').read_text(encoding='utf-8')

    def test_real_baseline_and_no_product_changes(self):
        self.assertEqual(git('rev-parse', BASE), BASE)
        self.assertEqual(git('branch', '--show-current'), 'codex/prototype-ui-integration')
        self.assertEqual(git('diff', '--name-only', BASE, '--', 'alpha', 'prototype', 'deploy', 'modao', 'scripts', 'tests'), '')
        self.assertFalse((ROOT / '.git/objects/info/alternates').exists())
        self.assertEqual(git('remote', 'get-url', 'origin'), 'https://github.com/hoangthithang880-dotcom/studyseat-prototype.git')

    def test_prototype_and_contract_references_exist(self):
        refs = [
            'AGENTS.md', 'prototype/student-app.js', 'prototype/admin-ui.js',
            'prototype/admin.css', 'prototype/unified-admin-bridge.js',
            'prototype/unified-student-runtime.js', 'modao/StudySeat_定版原型.html',
            'alpha/README.md', 'alpha/docs/API-v1.md', 'alpha/docs/RULES.md',
            'alpha/docs/PHASE3.md', 'alpha/docs/PHASE4.md', 'alpha/docs/PHASE4-REVIEW-FIXES.md',
        ]
        refs += [f'prototype/student/{name}.html' for name in ['home', 'room', 'confirm', 'bookings', 'profile']]
        refs += [f'docs/screenshots/{name}.png' for name in ['local-final-login', 'local-room', 'local-booking', 'local-admin-rules', 'local-admin-closure', 'local-admin-logs']]
        for path in refs:
            with self.subTest(path=path): self.assertTrue((ROOT / path).is_file())
        self.assertTrue(Path('/Users/zhouyiheng/Downloads/StudySeat_代码规范与冲刺计划.docx').is_file())

    def test_task_contains_actionable_scope_and_guards(self):
        for phrase in [str(ROOT), BASE, 'codex/prototype-ui-integration', 'AGENTS.md',
                       '先实际打开原型逐页操作',
                       'expected_version', 'CSRF', '只读接口', '不强推', '不合并、不部署',
                       '不要重置其数据', '不能只给方案', '失败、跳过或未执行',
                       '2026年11月29日23:59']:
            self.assertIn(phrase, self.task)
        self.assertIn('尚未完成界面改造', self.text)
        self.assertIn('只读接口增量', self.text)
        self.assertIn('原基线181项后端', self.text)
        self.assertIn('未实现的', self.text)
        self.assertNotIn('所有页面已经完成', self.text)

    def test_baseline_counts_are_real_historical_evidence(self):
        evidence = ROOT / 'alpha/evidence/phase4-review-fixes/full'
        suite = ET.parse(evidence / 'pytest.xml').getroot().find('testsuite')
        self.assertEqual(suite.get('tests'), '181')
        for key in ['failures', 'errors', 'skipped']: self.assertEqual(suite.get(key), '0')
        count = 0
        for directory in ['browser', 'reservations-browser', 'account-switch', 'initialization-browser', 'reservation-list-browser', 'phase3-browser', 'phase3-review-browser']:
            report = json.loads((evidence / directory / ('browser.json' if directory == 'browser' else 'results.json')).read_text())
            self.assertEqual(report['result'], 'passed')
            count += len(report.get('checks', report.get('scenarios', [])))
        self.assertEqual(count, 55)

    def test_document_has_twelve_sections_and_readable_tables(self):
        breaks = sum(p.paragraph_format.page_break_before is True for p in self.document.paragraphs)
        self.assertEqual(breaks, 11)
        self.assertEqual(len(self.document.tables), 10)
        for table in self.xml.findall('.//w:tbl', NS):
            self.assertIsNotNone(table.find('./w:tr/w:trPr/w:tblHeader', NS))
            self.assertIsNotNone(table.find('./w:tblPr/w:tblBorders', NS))
        for name in ['Title', 'Heading 1', 'Heading 2']:
            self.assertEqual(str(self.document.styles[name].font.color.rgb), '000000')
        targets = [r.get('Target') for r in self.rels if r.get('TargetMode') == 'External']
        self.assertEqual(len(targets), 5)
        self.assertIn('https://bbs.csdn.net/topics/620611106', targets)

    def test_original_materials_are_verified_and_ui_is_authoritative(self):
        manifest = json.loads((HERE / 'prototype-material-manifest.json').read_text())
        self.assertEqual(len(manifest['files']), 5)
        import hashlib
        for item in manifest['files']:
            a, b = Path(item['original']).read_bytes(), Path(item['working']).read_bytes()
            self.assertEqual(a, b)
            self.assertEqual(hashlib.sha256(a).hexdigest(), item['sha256'])
        for phrase in ['Alpha长表单不是原型基准', '原型已有核心交互缺接口', 'X01', 'X02', 'X03', 'U01', 'S01', 'S05', 'A01', 'A05']:
            self.assertIn(phrase, self.text)

    def test_original_repository_snapshot_and_modao_entry_are_pinned(self):
        manifest = json.loads((HERE / 'prototype-material-manifest.json').read_text())
        original = '2ba47d83ab5f22e8ea395b0753d54cd95e3d6e2f'
        self.assertEqual(manifest['original_prototype_commit'], original)
        self.assertIn(original, self.text)
        self.assertIn(original, self.task)
        self.assertIn('canvasId=rcVZMWRghgfFFxdw', manifest['official_modao_url'])
        self.assertIn('00 正式入口｜Study Seat', self.text)
        self.assertEqual(git('diff', '--name-only', original, BASE, '--', 'prototype', 'modao', 'deploy', 'docs/screenshots'), '')
        for item in manifest['files']:
            content = subprocess.check_output(['git', 'show', original + ':' + item['path']], cwd=ROOT)
            self.assertEqual(content, Path(item['working']).read_bytes())

    def test_ai_interaction_audit_is_a_release_gate(self):
        for phrase in ['AI逐控件交互自检门槛', '点了没反应', 'AI-INTERACTION-AUDIT.json',
                       '未测不填通过', '点击事件', '修复与复测', '不代表', '不得标ready']:
            self.assertIn(phrase, self.text + self.task)
        for field in ['control_id', 'page', 'role', 'state', 'action', 'expected', 'actual', 'result', 'evidence', 'commit']:
            self.assertIn(field, self.text)

    def test_rendered_chinese_and_pagination(self):
        pages = sorted(RENDER.glob('page-*.png'))
        self.assertEqual(len(pages), 12)
        pdf = RENDER / (DOCX.stem + '.pdf')
        fonts = subprocess.check_output([str(POPPLER / 'pdffonts'), str(pdf)], text=True)
        self.assertIn('STSongti-SC', fonts)
        text = subprocess.check_output([str(POPPLER / 'pdftotext'), '-layout', str(pdf), '-'], text=True)
        extracted = [p for p in text.split('\f') if p.strip()]
        self.assertEqual(len(extracted), 12)
        for index, page in enumerate(extracted, 1):
            with self.subTest(page=index):
                self.assertGreater(sum('\u4e00' <= c <= '\u9fff' for c in page), 150)
                self.assertIn('StudySeat', page)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--render-dir', required=True, type=Path)
    RENDER = parser.parse_args().render_dir
    unittest.main(argv=[__file__], verbosity=2)
