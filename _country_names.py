"""Inspect the bundled country dataset naming (map matching sanity check)."""
import re

s = open('storm-web/assets/js/worldmap-data.js', encoding='utf-8').read()
names = re.findall(r'"name":"([^"]+)"', s)
print('countries:', len(names))
print('sample:', names[:20])
probe = ['azerbaijan', 'turkey', 'russia', 'united states', 'germany', 'iran',
         'france', 'india', 'united kingdom', 'netherlands', 'sweden', 'china']
for p in probe:
    hits = [n for n in names if n.lower() == p]
    print(' ', p, '->', hits or 'NO EXACT MATCH',
          '| contains:', [n for n in names if p.split()[0] in n.lower()][:3])

