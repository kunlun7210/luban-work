"""Fetch and normalize the official Bing wallpaper listing for Pages."""
from json import loads, dumps
from pathlib import Path
import subprocess
from urllib.parse import urlencode, urljoin, urlsplit

root = Path(__file__).resolve().parents[1]
output = root / 'data'
output.mkdir(exist_ok=True)
origin = 'https://www.bing.com'
for market in ('zh-CN', 'en-US'):
    query = urlencode({'format': 'js', 'idx': 0, 'n': 8, 'mkt': market})
    target = origin + '/HPImageArchive.aspx?' + query
    listing = loads(subprocess.check_output([
        'curl', '--fail', '--silent', '--show-error', '--location',
        '--max-time', '15', '--retry', '2', target,
    ]))
    images = []
    for image in listing['images']:
        url = urljoin(origin, image['url'])
        parts = urlsplit(url)
        if parts.scheme != 'https' or parts.hostname != 'www.bing.com' or parts.path != '/th':
            continue
        day = image['startdate']
        images.append({
            'date': f'{day[:4]}-{day[4:6]}-{day[6:]}',
            'title': image.get('title', ''),
            'copyright': image.get('copyright', ''),
            'url': url,
        })
    if not images:
        raise ValueError(f'Bing returned no wallpapers for {market}')
    (output / f'bing-{market}.json').write_text(dumps({'images': images}, ensure_ascii=False, indent=2) + '\n')
