# -*- coding: utf-8 -*-
"""Build static and complete-source archives, preserving real modification times."""
from pathlib import Path
from datetime import datetime, timezone
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib, json

ROOT = Path(__file__).resolve().parents[1]


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    out=ROOT/'发布包'
    out.mkdir(exist_ok=True)
    plans=[]
    web=[p for p in (ROOT/'site').rglob('*') if p.is_file()]
    plans.append((out/'网页发布包.zip',[(p,p.relative_to(ROOT/'site').as_posix()) for p in web]))
    source=[]
    for p in ROOT.rglob('*'):
        rel=p.relative_to(ROOT)
        if not p.is_file() or any(part in ['work','发布包','__pycache__','.git','.venv'] or part=='.DS_Store' for part in rel.parts) or p.suffix=='.pyc':
            continue
        source.append((p,'评论治理工作台/'+rel.as_posix()))
    plans.append((out/'完整项目源代码.zip',source))
    records=[]
    for target,members in plans:
        with ZipFile(target,'w',ZIP_DEFLATED,compresslevel=9) as z:
            for p,name in sorted(members,key=lambda x:x[1]):
                assert not p.is_symlink()
                z.write(p,name)
        with ZipFile(target) as z:
            assert z.testzip() is None
            assert len(z.namelist())==len(set(z.namelist()))==len(members)
            for p,name in members:
                assert z.read(name)==p.read_bytes()
        records.append({'archive':target.relative_to(ROOT).as_posix(),'files':len(members),'bytes':target.stat().st_size,'sha256':sha(target),'member_bytes_verified':True})
    report={'actual_at_utc':datetime.now(timezone.utc).isoformat(),'archives':records,'file_times_randomized':False,'secrets_or_browser_storage_included':False}
    (ROOT/'work/打包核验.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(report,ensure_ascii=False))


if __name__=='__main__':
    main()
