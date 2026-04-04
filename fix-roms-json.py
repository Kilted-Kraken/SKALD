"""
Run this once to fix cleanName/region/tags in roms-snes.json.
Usage: python fix-roms-json.py
"""
import json, re, os

REGIONS = 'USA|Europe|Japan|World|Germany|France|Spain|Italy|Australia|Korea|China|Brazil|Netherlands|Sweden|Norway|Denmark|Finland|Russia|Poland|Canada|Mexico|Portugal|Greece|Hungary|Czech|Romania|Croatia|Serbia|Bulgaria|Ukraine|Israel|Turkey|India|Argentina|Chile|Colombia|Venezuela|Peru'
LANG    = 'En|Ja|De|Fr|Es|It|Nl|Pt|Sv|No|Da|Fi|Ru|Pl|Ko|Zh|Ar|He|Tr|Cs|Hu|Ro|Hr|Sr|Bg|Uk|El'
TAGS    = r'Beta|Proto|Sample|Demo|Rev\s*\d*|Hack|Alt|Unl|BIOS|Kiosk|Promo|Aftermarket|Virtual Console|Switch Online|Classic Mini|v[\d.]+'

region_blk = rf'\((?:(?:{REGIONS})(?:,\s*(?:{REGIONS}))*)\)'
lang_blk   = rf'\((?:(?:{LANG})(?:,\s*(?:{LANG}))*)\)'
any_blk    = rf'(?:{region_blk}|{lang_blk})'
tag_blk    = rf'\((?:{TAGS})[^)]*\)'

def parse(filename):
    base = re.sub(r'\.zip$', '', filename, flags=re.IGNORECASE)
    m = re.search(any_blk, base, re.IGNORECASE)
    region = m.group(0).strip('()') if m else ''
    tags = [t.strip('()') for t in re.findall(tag_blk, base, re.IGNORECASE)]
    clean = re.sub(any_blk, '', base, flags=re.IGNORECASE)
    clean = re.sub(tag_blk, '', clean, flags=re.IGNORECASE)
    clean = re.sub(r'\s{2,}', ' ', clean).strip()
    return clean or base, region, tags

script_dir = os.path.dirname(os.path.abspath(__file__))
json_path  = os.path.join(script_dir, 'assets', 'roms', 'roms-snes.json')

print(f'Reading {json_path}...')
with open(json_path, encoding='utf-8') as f:
    roms = json.load(f)

fixed = 0
for r in roms:
    clean, region, tags = parse(r['name'])
    if clean != r['cleanName'] or region != r['region']:
        fixed += 1
    r['cleanName'] = clean
    r['region']    = region
    r['tags']      = tags

from collections import Counter
counts = Counter(r['cleanName'].lower() for r in roms)
print(f'Fixed {fixed} entries | Unique titles: {len(counts)} | Total ROMs: {len(roms)}')

with open(json_path, 'w', encoding='utf-8') as f:
    json.dump(roms, f, separators=(',', ':'), ensure_ascii=False)

print(f'Written to {json_path}')
print('Done! Restart the launcher.')
