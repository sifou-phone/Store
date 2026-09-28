"""Generate the Sifou Phone circular stamp logo as a self-contained SVG.

All text is converted to outlines, so the SVG renders identically everywhere
without needing the fonts installed.
"""
import math
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

HERE = Path(__file__).parent
INK = "#141414"
BG = "#f4f3ef"
CX = CY = 800


class Font:
    def __init__(self, path):
        self.tt = TTFont(path)
        self.gs = self.tt.getGlyphSet()
        self.cmap = self.tt.getBestCmap()
        self.upm = self.tt["head"].unitsPerEm

    def glyph(self, ch):
        name = self.cmap[ord(ch)]
        pen = SVGPathPen(self.gs)
        self.gs[name].draw(pen)
        return pen.getCommands(), self.gs[name].width

    def width(self, text, size, tracking=0):
        s = size / self.upm
        return sum(self.glyph(c)[1] * s + tracking for c in text) - tracking


def text_straight(font, text, size, cx, baseline, tracking=0):
    s = size / font.upm
    x = cx - font.width(text, size, tracking) / 2
    out = []
    for ch in text:
        d, adv = font.glyph(ch)
        if d:
            out.append(f'<path transform="translate({x:.2f} {baseline:.2f}) scale({s:.5f} {-s:.5f})" d="{d}"/>')
        x += adv * s + tracking
    return "\n".join(out)


def text_arc(font, text, size, radius, center_deg, tracking=0, bottom=False):
    """Lay text along a circle. Top text reads clockwise, bottom text reads
    left-to-right with glyphs pointing inward."""
    s = size / font.upm
    total = font.width(text, size, tracking)
    sign = -1 if bottom else 1
    ang = math.radians(center_deg) - sign * (total / 2) / radius
    out = []
    for ch in text:
        d, adv = font.glyph(ch)
        w = adv * s
        mid = ang + sign * (w / 2) / radius
        px, py = CX + radius * math.cos(mid), CY + radius * math.sin(mid)
        rot = math.degrees(mid) + (-90 if bottom else 90)
        if d:
            out.append(
                f'<path transform="translate({px:.2f} {py:.2f}) rotate({rot:.3f}) '
                f'translate({-w / 2:.2f} 0) scale({s:.5f} {-s:.5f})" d="{d}"/>'
            )
        ang += sign * (w + tracking) / radius
    return "\n".join(out)


def star(cx, cy, r_out, r_in, rot=-90):
    pts = []
    for i in range(10):
        r = r_out if i % 2 == 0 else r_in
        a = math.radians(rot + i * 36)
        pts.append(f"{cx + r * math.cos(a):.2f},{cy + r * math.sin(a):.2f}")
    return f'<polygon points="{" ".join(pts)}" fill="{INK}" stroke="{INK}" stroke-width="3" stroke-linejoin="round"/>'


# Hand-drawn phone character, drawn around (800, 590) before scaling.
PHONE = f"""
<g fill="none" stroke="{INK}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
  <!-- arms -->
  <path d="M703 548 C680 536 650 512 612 468"/>
  <path d="M612 468 L590 470 M612 468 L600 446 M612 468 L624 447"/>
  <path d="M897 540 C924 522 954 498 990 458"/>
  <path d="M990 458 L1012 462 M990 458 L1003 437 M990 458 L977 438"/>
  <!-- legs + feet -->
  <path d="M772 742 C771 764 770 786 768 812"/>
  <path d="M768 812 C752 810 736 816 736 823 C737 831 760 830 775 824 C782 820 778 813 768 812 Z"/>
  <path d="M834 740 C837 762 840 782 843 806"/>
  <path d="M843 806 C858 802 876 806 877 814 C877 822 855 823 842 819 C834 816 835 808 843 806 Z"/>
  <g transform="rotate(-4 800 550)">
    <!-- body (double outline like the original laptop) -->
    <path d="M734 358 C770 355 830 354 866 357 C888 359 902 373 903 396
             C905 490 905 610 903 706 C902 728 888 742 866 743
             C822 745 778 745 734 743 C712 742 698 728 697 706
             C695 610 695 490 697 396 C698 373 712 360 734 358 Z"/>
    <path d="M739 366 C775 363 826 363 861 366 C881 368 894 380 895 400
             C897 492 897 608 895 702 C894 722 881 734 861 735
             C820 737 780 737 739 735 C719 734 706 722 705 702
             C703 608 703 492 705 400 C706 380 719 368 739 366 Z" stroke-width="3.5"/>
    <!-- screen -->
    <path d="M726 404 C775 402 826 402 874 404 C876 490 876 590 874 676
             C826 678 775 678 726 676 C724 590 724 490 726 404 Z" stroke-width="6"/>
    <!-- speaker + camera -->
    <path d="M781 385 L815 385"/>
    <circle cx="832" cy="385" r="4.5" fill="{INK}" stroke-width="3"/>
    <!-- home button -->
    <circle cx="800" cy="710" r="14" stroke-width="5"/>
    <!-- status bar: signal + battery -->
    <path d="M740 428 L740 426 M748 428 L748 422 M756 428 L756 418" stroke-width="4"/>
    <rect x="838" y="416" width="22" height="12" rx="3" stroke-width="3.5"/>
    <path d="M863 420 L863 424" stroke-width="3.5"/>
    <path d="M842 420 L852 420 L852 424 L842 424 Z" fill="{INK}" stroke-width="2"/>
    <!-- face -->
    <circle cx="776" cy="518" r="9.5" fill="{INK}" stroke="none"/>
    <circle cx="826" cy="516" r="9.5" fill="{INK}" stroke="none"/>
    <path d="M784 548 C790 568 812 568 818 546" stroke-width="6"/>
    <!-- app dock doodles (echo of the laptop keys) -->
    <rect x="741" y="628" width="22" height="22" rx="7" stroke-width="4"/>
    <rect x="773" y="627" width="22" height="22" rx="7" stroke-width="4"/>
    <rect x="805" y="627" width="22" height="22" rx="7" stroke-width="4"/>
    <rect x="837" y="628" width="22" height="22" rx="7" stroke-width="4"/>
  </g>
</g>
"""


def build(background=True):
    mono = Font(HERE / "fonts/CutiveMono-Regular.ttf")
    sans = Font(HERE / "fonts/Inter-Medium.ttf")

    word_size, word_track = 94, 9
    ring_size, ring_track = 50, 9

    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1600" width="1600" height="1600">',
        "<title>Sifou Phone</title>",
        "<defs>",
        '<filter id="wobble" x="-5%" y="-5%" width="110%" height="110%">'
        '<feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="7"/>'
        '<feDisplacementMap in="SourceGraphic" scale="4"/></filter>',
        '<filter id="soft" x="-10%" y="-40%" width="120%" height="180%">'
        '<feGaussianBlur in="SourceAlpha" stdDeviation="7"/><feOffset dy="6"/>'
        '<feComponentTransfer><feFuncA type="linear" slope="0.22"/></feComponentTransfer>'
        '<feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>',
        "</defs>",
    ]
    if background:
        parts.append(f'<rect width="1600" height="1600" fill="{BG}"/>')

    # stamp rings
    parts.append(f'<g fill="none" stroke="{INK}" filter="url(#wobble)">')
    parts.append(f'<circle cx="{CX}" cy="{CY}" r="636" stroke-width="9"/>')
    parts.append(f'<circle cx="{CX}" cy="{CY}" r="612" stroke-width="3"/>')
    parts.append(f'<circle cx="{CX}" cy="{CY}" r="478" stroke-width="3"/>')
    parts.append(f'<circle cx="{CX}" cy="{CY}" r="456" stroke-width="2" stroke-dasharray="2 12" stroke-linecap="round"/>')
    parts.append("</g>")

    # ring text + separators
    parts.append(f'<g fill="{INK}">')
    parts.append(text_arc(sans, "TÉLÉPHONES & ACCESSOIRES", ring_size, 527, -90, ring_track))
    parts.append(text_arc(sans, "QUALITÉ · SERVICE · CONFIANCE", ring_size, 563, 90, ring_track, bottom=True))
    parts.append("</g>")
    for deg in (180, 0):
        a = math.radians(deg)
        parts.append(star(CX + 545 * math.cos(a), CY + 545 * math.sin(a), 20, 8.5))

    # character
    parts.append(f'<g filter="url(#wobble)" transform="translate(800 656) scale(0.95) translate(-800 -590)">{PHONE}</g>')

    # wordmark
    parts.append(f'<g fill="{INK}" filter="url(#soft)">')
    parts.append(text_straight(mono, "sifou phone", word_size, CX, 1004, word_track))
    parts.append("</g>")
    parts.append(f'<g fill="{INK}">{text_straight(sans, "BOUTIQUE MOBILE", 28, CX, 1066, 10)}</g>')

    parts.append("</svg>")
    return "\n".join(parts)


if __name__ == "__main__":
    (HERE / "sifou-phone-logo.svg").write_text(build(True))
    (HERE / "sifou-phone-logo-transparent.svg").write_text(build(False))
    print("written")
