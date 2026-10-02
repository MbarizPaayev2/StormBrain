"""Insert the hover-country readout into stormmap.js pointermove handler."""
import io
import re

path = 'storm-web/assets/js/stormmap.js'
src = io.open(path, encoding='utf-8', newline='').read()

new = (
    "            var ll = self._cursorLatLng(cx, cy);\n"
    "            /* Show the hovered country's name next to the coordinates, so\n"
    "               hovering is informative as well as visual. */\n"
    "            var hoverName = self._hovered ? self._hovered.getAttribute('data-name') : null;\n"
    "            if (hoverName) {\n"
    "                self.readoutCoords.textContent = hoverName + (ll\n"
    "                    ? '   ' + ll.lat.toFixed(2) + '\\u00b0, ' + ll.lng.toFixed(2) + '\\u00b0'\n"
    "                    : '');\n"
    "            } else {\n"
    "                self.readoutCoords.textContent = ll\n"
    "                    ? ll.lat.toFixed(2) + '\\u00b0, ' + ll.lng.toFixed(2) + '\\u00b0'\n"
    "                    : 'Outside basemap bounds';\n"
    "            }\n"
    "            self.emit('cursor', ll);"
)

nl = '\r\n' if '\r\n' in src else '\n'
new = new.replace('\n', nl)

pattern = re.compile(
    r"[ \t]*var ll = self\._cursorLatLng\(cx, cy\);.*?self\.emit\('cursor', ll\);",
    re.S,
)
patched, count = pattern.subn(lambda m: new, src, count=1)
if count != 1:
    raise SystemExit(f'patch target not found (count={count})')

io.open(path, 'w', encoding='utf-8', newline='').write(patched)
print('readout hover patch applied')
