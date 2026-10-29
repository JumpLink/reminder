#!/usr/bin/env bash
# Extract translatable strings and compile the catalogues.
#
#   dev/i18n.sh extract    refresh po/reminder.pot and merge it into every po/*.po
#   dev/i18n.sh compile    build dist/locale/<lang>/LC_MESSAGES/reminder.mo
#
# Sources live in app/src and in the packages (the core and the backends raise most messages).
set -euo pipefail

cd "$(dirname "$0")/.."
DOMAIN='reminder'
POT="po/$DOMAIN.pot"

case "${1:-}" in
extract)
    # Paths are relative to app/, so the #: references stay stable for every checkout.
    find src ../packages/*/src -type f -name '*.ts' | sort > po/POTFILES.in
    xgettext \
        --files-from=po/POTFILES.in \
        --output="$POT" \
        --from-code=UTF-8 \
        --language=JavaScript \
        --keyword=_ \
        --keyword=_n:1,2 \
        --add-comments=TRANSLATORS \
        --package-name="$DOMAIN" \
        --msgid-bugs-address='https://github.com/JumpLink/reminder/issues'
    while read -r lang; do
        [ -n "$lang" ] || continue
        if [ -f "po/$lang.po" ]; then
            msgmerge --update --previous --backup=none "po/$lang.po" "$POT"
        else
            msginit --no-translator --locale="$lang" --input="$POT" --output-file="po/$lang.po"
        fi
    done < po/LINGUAS
    printf 'extracted %s msgids\n' "$(grep -c '^msgid "' "$POT")"
    ;;
compile)
    while read -r lang; do
        [ -n "$lang" ] || continue
        out="dist/locale/$lang/LC_MESSAGES"
        mkdir -p "$out"
        # `--check` refuses a msgstr whose format specifiers differ from its msgid.
        msgfmt --check --output-file="$out/$DOMAIN.mo" "po/$lang.po"
        printf 'compiled %-6s -> %s\n' "$lang" "$out/$DOMAIN.mo"
    done < po/LINGUAS
    ;;
*)
    printf 'usage: %s <extract|compile>\n' "$0" >&2
    exit 2
    ;;
esac
