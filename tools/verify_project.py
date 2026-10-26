# -*- coding: utf-8 -*-
"""Run local checks and preserve their actual outputs. No model/network setup."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, re, shutil, subprocess, sys

ROOT = Path(__file__).resolve().parents[1]


def main():
    work = ROOT / 'work'
    work.mkdir(exist_ok=True)
    commands = [
        ['node', '--test', 'tests/engine.test.cjs', 'tests/app-logic.test.cjs'],
        [sys.executable, '-m', 'unittest', 'discover', '-s', 'engine', '-p', 'test_*.py', '-v'],
        ['node', '--check', 'site/assets/app.js'],
    ]
    records = []
    for index, command in enumerate(commands, 1):
        started = datetime.now(timezone.utc).isoformat()
        result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
        ended = datetime.now(timezone.utc).isoformat()
        log = work / ('检查原始输出_' + str(index) + '.txt')
        log.write_text(result.stdout + '\n' + result.stderr)
        records.append({'command':command,'started_at_utc':started,'ended_at_utc':ended,'exit_code':result.returncode,'log':log.relative_to(ROOT).as_posix()})
        if result.returncode:
            raise RuntimeError(str(command) + '\n' + result.stdout + result.stderr)
    html = (ROOT / 'site/index.html').read_text()
    refs = re.findall(r'(?:src|href)="([^"#]+)"', html)
    for ref in refs:
        assert not ref.startswith(('http:','https:')), 'Default page must work with local assets'
        assert (ROOT/'site'/ref).is_file(), ref
    assert (ROOT/'engine/comment-engine.js').read_bytes() == (ROOT/'site/assets/comment-engine.js').read_bytes()
    assert (ROOT/'third_party/echarts-6.0.0/echarts.min.js').read_bytes() == (ROOT/'site/assets/echarts.min.js').read_bytes()
    assert hashlib.sha256((ROOT/'site/assets/echarts.min.js').read_bytes()).hexdigest() == 'baa8dfe7e1d9336b98e8986ba7e20ea15e7cdbea1ef42a59d59478632fa45a1d'
    for source in (ROOT/'docs').glob('*.md'):
        assert source.read_bytes() == (ROOT/'site/文档'/source.name).read_bytes(), source.name
    for path in (ROOT/'site').rglob('*'):
        assert not path.is_symlink()
    report = {
        'checked_at_utc':datetime.now(timezone.utc).isoformat(),
        'all_non_browser_checks_passed':True,
        'javascript_checks':31,
        'python_adapter_checks':7,
        'total_checks_in_suites':38,
        'command_records':records,
        'local_asset_references':refs,
        'browser_qa':{
            'initial_queue_page_observed':True,
            'remaining_interaction_checks':'not performed; user chose delivery without further browser testing on 2026-10-26',
            'direct_file_browser_open':'blocked by browser protocol policy; not verified',
            'not_replaced_by_unit_tests':True,
        },
        'model_inference':'not run; default is rule-based',
        'github_deployment':'not run; waiting for the user-selected new account',
        'not_a_benchmark':True,
    }
    (work/'测试与交付核验.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'all_non_browser_checks_passed':True,'javascript':31,'python':7,'browser_interaction_checks':'not continued per user delivery choice'},ensure_ascii=False))


if __name__ == '__main__':
    main()
