#!/usr/bin/env python3
"""Animated versions of the README diagrams (#366-#369).

Reads the static masters in ../readme/, keeps every box and label where it is, and adds
motion only to flow, strokes and outcomes. Output is self-contained for GitHub, which
renders SVG in <img> without fetching anything: fonts are subset to WOFF2 and images
downscaled, both embedded as data URIs. With prefers-reduced-motion the SVG is the
static poster, identical to the PNG.

Requires: pip install fonttools brotli pillow
Run: python public/assets/chalk-v1/motion/build.py
"""
import base64
import html
import io
import re
from pathlib import Path

from fontTools import subset
from PIL import Image

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
FONTS = {"Caveat": "Caveat.ttf", "Crimson Pro": "CrimsonPro.ttf", "JetBrains Mono": "JetBrainsMono.ttf"}


def b64(data, mime):
    return f"data:{mime};base64,{base64.b64encode(data).decode()}"


def font_uri(family, text):
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    font = subset.load_font(str(KIT / "fonts" / FONTS[family]), opts)
    sub = subset.Subsetter(opts)
    sub.populate(text=text)
    sub.subset(font)
    out = io.BytesIO()
    subset.save_font(font, out, opts)
    return b64(out.getvalue(), "font/woff2")


def image_uri(name, width, quality=82):
    im = Image.open(KIT / "masters" / name)
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    out = io.BytesIO()
    im.save(out, "WEBP", quality=quality, method=6)
    return b64(out.getvalue(), "image/webp")


def embed_fonts(svg):
    """Swap the kit's relative @font-face rules for subsets of only the glyphs this SVG draws."""
    text = html.unescape("".join(re.findall(r">([^<>]+)</t(?:ext|span)>", svg)))
    rules = []
    uses = re.sub(r"@font-face\{[^}]*\}", "", svg)  # families named by elements or class rules
    for family in FONTS:
        if f"'{family}'" in uses:
            rules.append(f"@font-face{{font-family:'{family}';src:url({font_uri(family, text)}) format('woff2');font-weight:400 800}}")
    return re.sub(r"(@font-face\{[^}]*\}\s*)+", "\n".join(rules) + "\n", svg, count=1)


def once(svg, old, new):
    assert svg.count(old) >= 1, f"missing: {old[:60]}"
    return svg.replace(old, new, 1)


def finish(svg, css):
    # Old ambient comets are replaced by the choreography below.
    svg = re.sub(r"<style>\s*\.comet.*?</style>", "", svg, flags=re.S)
    svg = re.sub(r' style="animation-delay:[^"]*"', "", svg)
    style = f"<style>{css}</style>"
    svg = svg.replace("</svg>", style + "</svg>")
    return embed_fonts(svg)


# A comet is a short dash (.12 of the path) that is parked just before the start (offset .12)
# and leaves past the end (offset -1). Hidden on the static poster.
COMET = ".cm{opacity:0}@media (prefers-reduced-motion:no-preference){.cm{opacity:1;stroke-dasharray:.12 2;stroke-dashoffset:.12;animation-duration:10s;animation-iteration-count:infinite;animation-timing-function:linear}"


def flow():
    svg = (KIT / "readme/flow.svg").read_text(encoding="utf-8")
    for cls in ("c-in", "c-top", "c-mid"):
        svg = once(svg, 'class="comet"', f'class="cm {cls}"')
    # Same hue as its track would vanish; the top comet runs in a pale green.
    svg = re.sub(r'stroke="#A7BE91"( stroke-width="3"[^>]*class="cm c-top")', r'stroke="#DCE8CD"\1', svg)
    svg = once(svg, 'stroke-dasharray="2 8"/>', 'stroke-dasharray="2 8"/><path d="M440 262 C478 262 462 424 500 424 H820" fill="none" stroke="#EE8F7D" stroke-width="3" stroke-linecap="round" pathLength="1" class="cm c-bot"/>')
    svg = once(svg, '<rect x="250" y="150"', '<rect class="core" x="250" y="150"')
    svg = once(svg, '<text x="500" y="216"', '<text class="ask" x="500" y="216"')
    for cls, ry, ty in (("o-top", 80, 105), ("o-mid", 242, 267), ("o-bot", 404, 429)):
        svg = once(svg, f'<rect x="830" y="{ry}"', f'<rect class="{cls}" x="830" y="{ry}"')
        svg = once(svg, f'<text x="895" y="{ty}"', f'<text class="{cls}" x="895" y="{ty}"')
    svg = svg.replace("../masters/guardian-chalk.webp", image_uri("guardian-chalk.webp", 192))
    css = COMET + """
.c-in{animation-name:cin}.c-top{animation-name:ctop}.c-mid{animation-name:cmid}.c-bot{animation-name:cbot}
@keyframes cin{0%{stroke-dashoffset:.12}8%,100%{stroke-dashoffset:-1}}
@keyframes ctop{0%,10%{stroke-dashoffset:.12}22%,100%{stroke-dashoffset:-1}}
@keyframes cmid{0%,28%{stroke-dashoffset:.12}38%,45%{stroke-dashoffset:-.42}54%,100%{stroke-dashoffset:-1}}
@keyframes cbot{0%,58%{stroke-dashoffset:.12}70%,100%{stroke-dashoffset:-1}}
.core{animation:core 10s infinite}.eyes{animation:eyes 10s infinite}.ask{animation:ask 10s infinite}
.o-top{animation:otop 10s infinite}.o-mid{animation:omid 10s infinite}.o-bot{animation:obot 10s infinite}
@keyframes core{0%,7%{stroke:#29343E}10%{stroke:#E6B04B}18%,100%{stroke:#29343E}}
@keyframes eyes{0%,7%{opacity:.25}11%{opacity:1}18%,38%{opacity:.25}41%,45%{opacity:1}50%,100%{opacity:.25}}
@keyframes ask{0%,37%{opacity:1}39%{opacity:.35}41%{opacity:1}43%{opacity:.35}45%,100%{opacity:1}}
@keyframes otop{0%,21%{opacity:.3}23%,94%{opacity:1}100%{opacity:.3}}
@keyframes omid{0%,53%{opacity:.3}55%,94%{opacity:1}100%{opacity:.3}}
@keyframes obot{0%,69%{opacity:.3}71%,94%{opacity:1}100%{opacity:.3}}
}"""
    return finish(svg, css)


def primitive():
    svg = (KIT / "readme/primitive.svg").read_text(encoding="utf-8")
    order = 0

    def chip(m):
        nonlocal order
        bad = m.group(1) == "196" and m.group(2) == "148"
        cls = "chip bad-chip" if bad else "chip"
        out = f'<rect class="{cls}" style="animation-delay:{order * 0.1:.1f}s" x="{m.group(1)}" y="{m.group(2)}" width="144"'
        order += 1
        return out

    svg = re.sub(r'<rect x="(40|196)" y="(\d+)" width="144"', chip, svg)
    svg = svg.replace('style="animation-delay:', 'data-d="')  # keep delays through finish()
    svg = once(svg, '<text x="268" y="169"', '<text class="bad-txt" x="268" y="169"')
    svg = re.sub(r'<path d="M340 (\d+) C', lambda m: f'<path class="link{" bad-link" if m.group(1) == "164" else ""}" pathLength="1" d="M340 {m.group(1)} C', svg)
    svg = once(svg, '<rect x="450" y="124"', '<rect class="hash" x="450" y="124"')
    svg = once(svg, 'class="comet"', 'class="cm c-sign"')
    svg = once(svg, '<rect x="790" y="124"', '<rect class="enf" x="790" y="124"')
    svg = once(svg, '<text x="450" y="275"', '<text class="verdict" x="450" y="275"')
    svg = finish(svg, COMET + """
.c-sign{animation-name:csign}
@keyframes csign{0%,24%{stroke-dashoffset:.12}34%,100%{stroke-dashoffset:-1}}
.chip{animation:chip 10s infinite}.bad-chip{animation-name:badchip}.bad-txt{animation:badtxt 10s infinite}
.link{stroke-dasharray:1;animation:link 10s infinite}.bad-link{animation:link 10s infinite,badlink 10s infinite}
.hash{animation:hash 10s infinite}.enf{animation:enf 10s infinite}.verdict{animation:verdict 10s infinite}
@keyframes chip{0%{stroke:#29343E}3%{stroke:#E6B04B}10%,100%{stroke:#29343E}}
@keyframes badchip{0%{stroke:#29343E}3%{stroke:#E6B04B}10%,52%{stroke:#29343E}55%,73%{stroke:#EE8F7D}78%,100%{stroke:#29343E}}
@keyframes badtxt{0%,52%{fill:#EEE8D8}55%,73%{fill:#EE8F7D}78%,100%{fill:#EEE8D8}}
@keyframes link{0%,6%{stroke-dashoffset:1}16%,94%{stroke-dashoffset:0}99%,100%{stroke-dashoffset:1}}
@keyframes badlink{0%,54%{stroke:#8A96A3}57%,75%{stroke:#EE8F7D}80%,100%{stroke:#8A96A3}}
@keyframes hash{0%,15%{stroke:#29343E}19%,54%{stroke:#E6B04B}57%,75%{stroke:#EE8F7D}80%,94%{stroke:#E6B04B}100%{stroke:#29343E}}
@keyframes enf{0%,33%{stroke-opacity:.35}37%,54%{stroke-opacity:1}57%,75%{stroke-opacity:.2}80%,94%{stroke-opacity:1}100%{stroke-opacity:.35}}
@keyframes verdict{0%,55%{fill:#EEE8D8}58%,75%{fill:#EE8F7D}80%,100%{fill:#EEE8D8}}
}""")
    return svg.replace('data-d="', 'style="animation-delay:')


def scenarios():
    svg = (KIT / "readme/scenarios.svg").read_text(encoding="utf-8")
    parts = re.split(r'(?=<rect x="\d+" y="(?:64|226)" width="296")', svg)
    for k in range(1, len(parts)):
        d = f'style="animation-delay:{(k - 1) * 0.7:.1f}s"'.replace('style="animation-delay:', 'data-d="')
        p = parts[k]
        p = p.replace('<path d=', f'<path class="ln" pathLength="1" {d} d=', 1)
        p = p.replace("<circle ", f'<circle class="dot" {d} ')
        p = re.sub(r'<path (d="M\d+ \d+ H\d+"[^>]*stroke-dasharray="2 8")', rf'<path class="dash" {d} \1', p)
        p = re.sub(r'<path (d="M\d+ \d+ l12 12)', rf'<path class="x" {d} \1', p)
        p = re.sub(r'<text (x="\d+" y="(?:190|352)")', rf'<text class="code" {d} \1', p)
        parts[k] = p
    svg = finish("".join(parts), """
@media (prefers-reduced-motion:no-preference){
.ln{stroke-dasharray:1;animation:ln 10s infinite}.dot{animation:dot 10s infinite}.dash{animation:dash 10s infinite}
.x{transform-box:fill-box;transform-origin:center;animation:x 10s infinite}.code{animation:code 10s infinite}
@keyframes ln{0%{stroke-dashoffset:1}9%,90%{stroke-dashoffset:0}96%,100%{stroke-dashoffset:1}}
@keyframes dot{0%,8%{opacity:0}10%,90%{opacity:1}96%,100%{opacity:0}}
@keyframes dash{0%,9%{opacity:0}12%,90%{opacity:1}96%,100%{opacity:0}}
@keyframes x{0%,12%{opacity:0;transform:scale(.4)}14%{opacity:1;transform:scale(1.2)}16%,90%{opacity:1;transform:scale(1)}96%,100%{opacity:0;transform:scale(1)}}
@keyframes code{0%,10%{opacity:.35}13%,90%{opacity:1}96%,100%{opacity:.35}}
}""")
    return svg.replace('data-d="', 'style="animation-delay:')


def hero():
    svg = (KIT / "readme/hero.svg").read_text(encoding="utf-8")
    svg = once(svg, '<image href="../masters/guardian-chalk.webp"', '<image class="gd" href="../masters/guardian-chalk.webp"')
    svg = svg.replace("../masters/guardian-chalk.webp", image_uri("guardian-chalk.webp", 720))
    svg = svg.replace("../masters/slate-texture.webp", image_uri("slate-texture.webp", 1200, 60))
    svg = once(svg, "</defs>", '<mask id="write"><rect class="wr" x="40" y="40" width="380" height="150" fill="#fff"/></mask></defs>')
    svg = once(svg, '<text x="54" y="164" class="chalk"', '<text mask="url(#write)" x="54" y="164" class="chalk pt"')
    svg = once(svg, '<text x="62" y="220" class="editorial"', '<text x="62" y="220" class="editorial t1"')
    svg = once(svg, '<text x="62" y="258" class="editorial"', '<text x="62" y="258" class="editorial t2"')
    pulse = re.search(r'<path d="M0 326 [^>]*/>', svg).group(0)
    svg = svg.replace(pulse, pulse.replace("<path ", '<path class="pl" pathLength="1" ') +
                      pulse.replace("<path ", '<path class="pc" pathLength="1" ').replace('stroke="#E6B04B"', 'stroke="#FFE2A0"').replace('stroke-width="3"', 'stroke-width="4"').replace(' filter="url(#chalk)"', ""))
    # A 10 s loop like the other diagrams: a one-shot intro is already over when a reader scrolls back up.
    svg = finish(svg, """.pc{opacity:0}
@media (prefers-reduced-motion:no-preference){
.wr{transform-box:fill-box;transform-origin:left center;animation:wr 10s cubic-bezier(.6,0,.3,1) infinite}
.pt{animation:out 10s infinite}
.t1{animation:t1 10s cubic-bezier(.16,1,.3,1) infinite}.t2{animation:t2 10s cubic-bezier(.16,1,.3,1) infinite}
.gd{animation:ink 10s cubic-bezier(.2,.8,.2,1) infinite}
.pl{stroke-dasharray:1;animation:draw 10s cubic-bezier(.65,0,.35,1) infinite}
.pc{opacity:1;stroke-dasharray:.05 2;stroke-dashoffset:.05;animation:run 10s linear infinite}
@keyframes wr{0%,2%{transform:scaleX(0)}13%,100%{transform:scaleX(1)}}
@keyframes out{0%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes t1{0%,10%{opacity:0;transform:translateY(10px)}16%,92%{opacity:1;transform:none}97%,100%{opacity:0}}
@keyframes t2{0%,13%{opacity:0;transform:translateY(10px)}19%,92%{opacity:1;transform:none}97%,100%{opacity:0}}
@keyframes ink{0%,3%{opacity:0;filter:blur(6px)}14%,92%{opacity:1;filter:blur(0)}97%,100%{opacity:0}}
@keyframes draw{0%,13%{stroke-dashoffset:1;opacity:1}25%,92%{stroke-dashoffset:0;opacity:1}97%{stroke-dashoffset:0;opacity:0}100%{stroke-dashoffset:1;opacity:0}}
@keyframes run{0%,28%{stroke-dashoffset:.05}52%{stroke-dashoffset:-1}52.1%,60%{stroke-dashoffset:.05}84%,100%{stroke-dashoffset:-1}}
}""")
    return svg


def main():
    for name, build in (("hero", hero), ("flow", flow), ("primitive", primitive), ("scenarios", scenarios)):
        out = HERE / f"{name}.svg"
        out.write_text(build(), encoding="utf-8", newline="\n")
        print(f"{out.relative_to(KIT.parent.parent.parent)}  {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
