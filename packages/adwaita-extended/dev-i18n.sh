#!/usr/bin/env bash
# Refresh po/gjsify-adwaita-extended.pot from src and merge it into every po/*.po.
set -euo pipefail
cd "$(dirname "$0")"
DOMAIN='gjsify-adwaita-extended'
find src -type f -name '*.ts' ! -name '*.story.ts' | sort > po/POTFILES.in
xgettext --files-from=po/POTFILES.in --output="po/$DOMAIN.pot" --from-code=UTF-8 \
    --language=JavaScript --keyword=_ --keyword=_n:1,2 --add-comments=TRANSLATORS \
    --package-name="$DOMAIN" --msgid-bugs-address='https://github.com/gjsify/gjsify/issues'
while read -r lang; do
    [ -n "$lang" ] || continue
    if [ -f "po/$lang.po" ]; then msgmerge --update --previous --backup=none "po/$lang.po" "po/$DOMAIN.pot"
    else msginit --no-translator --locale="$lang" --input="po/$DOMAIN.pot" --output-file="po/$lang.po"; fi
done < po/LINGUAS
