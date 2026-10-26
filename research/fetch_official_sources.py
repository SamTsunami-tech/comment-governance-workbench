import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REPOS = ['apache/echarts', 'unitaryai/detoxify', 'HumanSignal/label-studio',
         'evidentlyai/evidently', 'argilla-io/argilla', 'paul-rottger/hatecheck-data']

def get(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'CommentOps-research'})
    with urllib.request.urlopen(request, timeout=25) as response:
        return response.read()

def one(repo):
    out = {'repository': repo, 'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    try:
        meta = json.loads(get('https://api.github.com/repos/' + repo))
        branch = meta['default_branch']
        commit = '52104f7daefb8d01ea809189dab81cadc874ce09' if repo == 'apache/echarts' else json.loads(get('https://api.github.com/repos/' + repo + '/commits/' + branch))['sha']
        out.update(url=meta['html_url'], default_branch=branch, commit=commit,
                   license_api=meta.get('license'), archived=meta['archived'], pushed_at=meta['pushed_at'])
        files = {}
        paths = ['dist/echarts.min.js', 'LICENSE', 'NOTICE', 'README.md'] if repo == 'apache/echarts' else ['README.md', 'LICENSE']
        for name in paths:
            url = 'https://raw.githubusercontent.com/' + repo + '/' + commit + '/' + name
            try:
                data = get(url)
                target = ROOT / ('third_party/echarts-6.0.0/' + Path(name).name) if repo == 'apache/echarts' else ROOT / 'research' / (repo.replace('/', '__') + '__' + name)
                target.write_bytes(data)
                files[name] = {'path': str(target.relative_to(ROOT)), 'source': url, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}
            except Exception as exc:
                files[name] = {'source': url, 'error': str(exc)}
        out['files'] = files
    except Exception as exc:
        out['error'] = str(exc)
    return out

if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
        results = list(executor.map(one, REPOS))
    target = ROOT / 'research/repository_checks.json'
    target.write_text(json.dumps(results, ensure_ascii=False, indent=2))
    for result in results:
        print(result['repository'], result.get('commit'), result.get('license_api'), result.get('error'))
