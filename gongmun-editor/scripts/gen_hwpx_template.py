"""한컴 오피스로 만든 빈 HWPX(Skeleton.hwpx)에서 src/hwpxTemplate.js를 만든다.

Skeleton.hwpx 출처: python-hwpx (https://pypi.org/project/python-hwpx/, Apache-2.0)
    pip download python-hwpx --no-deps && unzip -j *.whl 'hwpx/data/Skeleton.hwpx'
    python3 scripts/gen_hwpx_template.py Skeleton.hwpx
"""
import json
import re
import sys
import zipfile
from pathlib import Path

src = sys.argv[1]
z = zipfile.ZipFile(src)
read = lambda n: z.read(n).decode("utf-8")

section = read("Contents/section0.xml")
sec_open = re.match(r"^(<\?xml[^>]*\?>)(<hs:sec [^>]*>)", section)
secpr = re.search(r"<hp:secPr .*?</hp:secPr><hp:ctrl>.*?</hp:ctrl>", section).group(0)

parts = {
    "HEADER_XML": read("Contents/header.xml"),
    "SECTION_OPEN": sec_open.group(1) + sec_open.group(2),
    "SECPR": secpr,
    "CONTENT_HPF": read("Contents/content.hpf"),
    "VERSION_XML": read("version.xml"),
    "SETTINGS_XML": read("settings.xml"),
    "CONTAINER_XML": read("META-INF/container.xml"),
    "MANIFEST_XML": read("META-INF/manifest.xml"),
    "CONTAINER_RDF": read("META-INF/container.rdf"),
}
out = [
    "// 자동 생성 파일 — scripts/gen_hwpx_template.py로 다시 만든다. 직접 고치지 말 것.",
    "// 한컴 오피스 한글로 만든 빈 문서(Skeleton.hwpx, python-hwpx 프로젝트, Apache-2.0)의 구성 요소.",
]
for k, v in parts.items():
    out.append(f"export const {k} = {json.dumps(v, ensure_ascii=False)};")
Path(__file__).resolve().parent.parent.joinpath("src/hwpxTemplate.js").write_text("\n".join(out) + "\n", encoding="utf-8")
print("src/hwpxTemplate.js")
