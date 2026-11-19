#!/usr/bin/env bash
# Extract translatable strings and compile the catalogues.
#
#   dev/i18n.sh extract    refresh po/reminder.pot and merge it into every po/*.po
#   dev/i18n.sh compile    build dist/locale/<lang>/LC_MESSAGES/reminder.mo
#
# Sources live in app/src (.ts and .blp) and in the packages (the core and the backends raise most messages).
set -euo pipefail

cd "$(dirname "$0")/.."
DOMAIN='reminder'
POT="po/$DOMAIN.pot"

case "${1:-}" in
extract)
    # Paths are relative to app/, so the #: references stay stable for every checkout.
    # adwaita-extended binds its own domain (dgettext) and ships its own catalogue.
    { find src ../packages/*/src -type f -name '*.ts' ! -path '../packages/adwaita-extended/*'
      find src -type f -name '*.blp'; } | LC_ALL=C sort > po/POTFILES.in
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    grep -v '\.blp$' po/POTFILES.in > "$tmp/js" || true
    grep '\.blp$' po/POTFILES.in > "$tmp/blp" || true
    xgettext \
        --files-from="$tmp/js" \
        --output="$POT" \
        --from-code=UTF-8 \
        --language=JavaScript \
        --keyword=_ \
        --keyword=_n:1,2 \
        --add-comments=TRANSLATORS \
        --package-name="$DOMAIN" \
        --msgid-bugs-address='https://github.com/JumpLink/reminder/issues'
    # Blueprint marks strings as _("…"), which xgettext reads as C; the second pass joins them in.
    if [ -s "$tmp/blp" ]; then
        xgettext \
            --files-from="$tmp/blp" \
            --output="$POT" \
            --join-existing \
            --from-code=UTF-8 \
            --language=C \
            --keyword=_ \
            --keyword=C_:1c,2 \
            --add-comments=TRANSLATORS \
            --package-name="$DOMAIN" \
            --msgid-bugs-address='https://github.com/JumpLink/reminder/issues'
    fi
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
    # The widget package has its own domain; the app ships its catalogue next to its own.
    widgets=../packages/adwaita-extended/po
    while read -r lang; do
        [ -n "$lang" ] || continue
        out="dist/locale/$lang/LC_MESSAGES"
        mkdir -p "$out"
        msgfmt --check --output-file="$out/gjsify-adwaita-extended.mo" "$widgets/$lang.po"
        printf 'compiled %-6s -> %s\n' "$lang" "$out/gjsify-adwaita-extended.mo"
    done < "$widgets/LINGUAS"
    ;;
*)
    printf 'usage: %s <extract|compile>\n' "$0" >&2
    exit 2
    ;;
esac
