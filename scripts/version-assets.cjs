/* Compatibility entry: rebuild and version the complete approved prototype. */
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const result=spawnSync(process.env.STUDYSEAT_PYTHON||'python3',[path.join(__dirname,'build-prototype.py')],{stdio:'inherit'});
if(result.error)throw result.error;process.exitCode=result.status??1;
