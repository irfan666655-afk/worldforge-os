#!/usr/bin/env python3
"""
build_manual.py — WorldForge OS Master Manual PDF generator.

Compiles the truth extracted from the full source tree (src/, test/, scripts/,
docs/decision_log.md, docs/SYSTEM_IDENTITY.md, docs/chaos-report, and the
work/*.json telemetry) into a corporate-grade PDF.

Every metric in the Verification Scoreboard is copied verbatim from measured
telemetry in the archive (work/matrix-48-run.json, work/jarvis-run.json) and
the smoke-suite pass counts. Nothing is invented. The repo's own honesty
contracts (mock gateway, local job-runner, keyless chain) are preserved.

Output: docs/WorldForge_OS_Master_Manual.pdf
"""
import os
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Table, TableStyle,
    PageBreak, NextPageTemplate, HRFlowable, KeepTogether, ListFlowable, ListItem,
)
from reportlab.pdfgen import canvas

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "..", "..", "..", "..", "..", "home", "user",
                   "worldforge-os", "docs", "WorldForge_OS_Master_Manual.pdf")
# Prefer the explicit absolute target if it exists.
ABS = "/home/user/worldforge-os/docs/WorldForge_OS_Master_Manual.pdf"
OUT = ABS

# ---------------------------------------------------------------- palette
INK      = colors.HexColor("#0f1419")   # near-black text
SLATE    = colors.HexColor("#28323c")   # dark slate (title page)
STEEL    = colors.HexColor("#3d5a73")   # steel blue (headers)
ACCENT   = colors.HexColor("#c8862a")   # notary gold (accents/rules)
TEAL     = colors.HexColor("#1f6f6b")   # verification green-teal
MUTED    = colors.HexColor("#5c6a76")   # muted caption grey
LINE     = colors.HexColor("#c9d2da")   # hairline
PANEL    = colors.HexColor("#f2f5f8")   # light panel fill
PANEL2   = colors.HexColor("#eef2ea")   # green-tinted panel
GREEN    = colors.HexColor("#2e7d32")   # pass green
RED      = colors.HexColor("#b23c2e")   # fail-closed red

# ---------------------------------------------------------------- styles
styles = getSampleStyleSheet()

def S(name, **kw):
    kw.setdefault("parent", styles["Normal"])
    return ParagraphStyle(name, **kw)

body = S("body", fontName="Times-Roman", fontSize=10.5, leading=15.5,
         alignment=TA_JUSTIFY, textColor=INK, spaceAfter=7)
body_l = S("body_l", parent=body, alignment=TA_LEFT)
lead = S("lead", parent=body, fontSize=11.5, leading=17, textColor=SLATE,
         spaceAfter=9)
h1 = S("h1", fontName="Helvetica-Bold", fontSize=19, leading=23,
       textColor=STEEL, spaceBefore=6, spaceAfter=2)
h1num = S("h1num", fontName="Helvetica-Bold", fontSize=10, leading=12,
          textColor=ACCENT, spaceAfter=1, tracking=1)
h2 = S("h2", fontName="Helvetica-Bold", fontSize=13, leading=17,
       textColor=INK, spaceBefore=14, spaceAfter=4)
h3 = S("h3", fontName="Helvetica-BoldOblique", fontSize=11, leading=15,
       textColor=STEEL, spaceBefore=9, spaceAfter=3)
caption = S("caption", fontName="Helvetica-Oblique", fontSize=8.5, leading=12,
            textColor=MUTED, spaceAfter=6)
mono = S("mono", fontName="Courier", fontSize=8.5, leading=12, textColor=INK)
mono_w = S("mono_w", fontName="Courier-Bold", fontSize=8.5, leading=12,
           textColor=colors.white)
cell = S("cell", fontName="Times-Roman", fontSize=9, leading=12, textColor=INK)
cell_b = S("cell_b", parent=cell, fontName="Helvetica-Bold")
cell_h = S("cell_h", fontName="Helvetica-Bold", fontSize=9, leading=12,
           textColor=colors.white)
cell_mono = S("cell_mono", fontName="Courier", fontSize=8, leading=11, textColor=INK)
quote = S("quote", fontName="Times-Italic", fontSize=11, leading=16,
          textColor=SLATE, leftIndent=14, rightIndent=14, spaceAfter=8,
          borderPadding=(2, 2, 2, 2))
tag = S("tag", fontName="Helvetica-Bold", fontSize=8, leading=11,
        textColor=colors.white)

# Title page styles
t_kicker = S("t_kicker", fontName="Helvetica-Bold", fontSize=11, leading=15,
             textColor=ACCENT, alignment=TA_CENTER, tracking=3)
t_title = S("t_title", fontName="Helvetica-Bold", fontSize=33, leading=38,
            textColor=colors.white, alignment=TA_CENTER)
t_sub = S("t_sub", fontName="Times-Italic", fontSize=15, leading=21,
          textColor=colors.HexColor("#c9d6e0"), alignment=TA_CENTER)
t_meta = S("t_meta", fontName="Helvetica", fontSize=9.5, leading=15,
           textColor=colors.HexColor("#9fb0bd"), alignment=TA_CENTER)

# ---------------------------------------------------------------- helpers
def rule(color=LINE, w=0.8, space_after=8, space_before=0):
    return HRFlowable(width="100%", thickness=w, color=color,
                      spaceBefore=space_before, spaceAfter=space_after)

def chapter(number, title):
    return [
        Spacer(1, 2),
        Paragraph(number, h1num),
        Paragraph(title, h1),
        rule(ACCENT, 1.4, space_after=12),
    ]

def panel(flowables, fill=PANEL, border=LINE, pad=9):
    t = Table([[flowables]], colWidths=[168 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), fill),
        ("BOX", (0, 0), (-1, -1), 0.8, border),
        ("LEFTPADDING", (0, 0), (-1, -1), pad),
        ("RIGHTPADDING", (0, 0), (-1, -1), pad),
        ("TOPPADDING", (0, 0), (-1, -1), pad),
        ("BOTTOMPADDING", (0, 0), (-1, -1), pad),
    ]))
    return t

def accent_panel(flowables, bar=ACCENT, fill=PANEL, pad=9):
    """Panel with a colored left accent bar."""
    t = Table([["", flowables]], colWidths=[3.2 * mm, 164.8 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), bar),
        ("BACKGROUND", (1, 0), (1, -1), fill),
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("LEFTPADDING", (1, 0), (1, -1), pad),
        ("RIGHTPADDING", (1, 0), (1, -1), pad),
        ("TOPPADDING", (0, 0), (-1, -1), pad),
        ("BOTTOMPADDING", (0, 0), (-1, -1), pad),
        ("LEFTPADDING", (0, 0), (0, -1), 0),
        ("RIGHTPADDING", (0, 0), (0, -1), 0),
    ]))
    return t

def P(text, style=body):
    return Paragraph(text, style)

def bullets(items, style=body_l, bullet_color=ACCENT):
    lis = [ListItem(Paragraph(t, style), value=None, leftIndent=16,
                    bulletColor=bullet_color) for t in items]
    return ListFlowable(lis, bulletType="bullet", start="•",
                        bulletFontSize=8, leftIndent=12, bulletColor=bullet_color)

# ---------------------------------------------------------------- canvas / page furniture
class Manual(BaseDocTemplate):
    def __init__(self, filename, **kw):
        super().__init__(filename, **kw)

def _footer(canv, doc, dark=False):
    canv.saveState()
    w, h = A4
    if not dark:
        canv.setStrokeColor(LINE)
        canv.setLineWidth(0.6)
        canv.line(20 * mm, 15 * mm, w - 20 * mm, 15 * mm)
        canv.setFont("Helvetica", 7.5)
        canv.setFillColor(MUTED)
        canv.drawString(20 * mm, 11 * mm, "WorldForge OS — Master Manual")
        canv.drawRightString(w - 20 * mm, 11 * mm,
                             "Confidential · Trust & Governance Architecture")
        canv.setFont("Helvetica-Bold", 8)
        canv.setFillColor(STEEL)
        canv.drawCentredString(w / 2, 11 * mm, str(doc.page))
    canv.restoreState()

def cover_bg(canv, doc):
    canv.saveState()
    w, h = A4
    canv.setFillColor(SLATE)
    canv.rect(0, 0, w, h, fill=1, stroke=0)
    # top and bottom accent rules
    canv.setStrokeColor(ACCENT)
    canv.setLineWidth(2)
    canv.line(30 * mm, h - 55 * mm, w - 30 * mm, h - 55 * mm)
    canv.setLineWidth(0.7)
    canv.setStrokeColor(colors.HexColor("#4a5a68"))
    canv.line(30 * mm, 42 * mm, w - 30 * mm, 42 * mm)
    # faint monogram
    canv.setFillColor(colors.HexColor("#33414d"))
    canv.setFont("Helvetica-Bold", 150)
    canv.drawCentredString(w / 2, h / 2 - 20 * mm, "WF")
    canv.restoreState()

def content_page(canv, doc):
    _footer(canv, doc, dark=False)

FRAME = Frame(20 * mm, 18 * mm, A4[0] - 40 * mm, A4[1] - 36 * mm,
              id="content", leftPadding=0, rightPadding=0,
              topPadding=6, bottomPadding=6)
COVER_FRAME = Frame(30 * mm, 45 * mm, A4[0] - 60 * mm, A4[1] - 95 * mm,
                    id="cover", leftPadding=0, rightPadding=0)

# ================================================================ CONTENT
story = []

# ---- COVER -----------------------------------------------------------
story += [
    Spacer(1, 32 * mm),
    Paragraph("WORLDFORGE&nbsp;OS", t_kicker),
    Spacer(1, 10 * mm),
    Paragraph("The Comprehensive Trust<br/>&amp; Governance Architecture", t_title),
    Spacer(1, 9 * mm),
    Paragraph("Master Manual", t_sub),
    Spacer(1, 4 * mm),
    Paragraph("A governance engine wearing a creative-pipeline UI:<br/>"
              "its real product is an unfakeable decision record.", t_meta),
    Spacer(1, 26 * mm),
    Paragraph("163,940-byte single-file artifact&nbsp;&nbsp;·&nbsp;&nbsp;zero runtime dependencies"
              "<br/>48 verification lanes GREEN&nbsp;&nbsp;·&nbsp;&nbsp;133/133 smoke assertions"
              "<br/>9 hostile chaos-probe families&nbsp;&nbsp;·&nbsp;&nbsp;zero findings", t_meta),
    Spacer(1, 14 * mm),
    Paragraph("Compiled %s&nbsp;&nbsp;·&nbsp;&nbsp;Ratification authority: Irfan"
              % datetime.now().strftime("%Y-%m-%d"), t_meta),
]
story.append(NextPageTemplate("content"))
story.append(PageBreak())

# ---- TABLE OF CONTENTS ----------------------------------------------
story += chapter("CONTENTS", "What This Manual Covers")
toc_rows = [
    ["1", "Executive Summary", "The record that cannot be quietly falsified"],
    ["2", "Core Philosophy", "The ontology of the four nested trust boundaries"],
    ["3", "Technical Deep-Dive", "Mutation FIFO · Recovery (G1) · Event Chain (G2) · Payment Bridge"],
    ["4", "Verification Scoreboard", "48-lane matrix · 133 smoke assertions · chaos immunity"],
    ["5", "Strategic Roadmap", "Governance substrate extraction & commercial scaling"],
    ["A", "Appendix", "Decision log, error register & measured inventory"],
]
tt = Table([[P(n, cell_b), P(t, cell_b), P(d, cell)] for n, t, d in toc_rows],
           colWidths=[12 * mm, 52 * mm, 104 * mm])
tt.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LINEBELOW", (0, 0), (-1, -2), 0.5, LINE),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ("TEXTCOLOR", (0, 0), (0, -1), ACCENT),
]))
story += [tt, Spacer(1, 10)]
story += [accent_panel([P(
    "<b>Provenance of this document.</b> Every architectural claim below was read "
    "directly from the extracted source tree (<font face='Courier'>src/</font>, "
    "<font face='Courier'>test/</font>, <font face='Courier'>scripts/</font>, "
    "<font face='Courier'>build.mjs</font>) and the ratified records in "
    "<font face='Courier'>docs/decision_log.md</font> and "
    "<font face='Courier'>docs/SYSTEM_IDENTITY.md</font>. Every number in the "
    "Verification Scoreboard (Chapter 4) is copied verbatim from measured telemetry "
    "in the archive — <font face='Courier'>work/matrix-48-run.json</font> and "
    "<font face='Courier'>work/jarvis-run.json</font> — not estimated. Where the "
    "system documents a limit (mock gateway, local job-runner, keyless chain), this "
    "manual repeats the limit rather than papering over it.", body_l)], bar=STEEL)]
story.append(PageBreak())

# ================================================================ 1. EXEC SUMMARY
story += chapter("CHAPTER 1", "Executive Summary")
story += [Paragraph(
    "WorldForge OS presents itself as a 3D creative-production pipeline tracker — "
    "ten stages, three gates, a budget ledger, an asset library, eight guilds. "
    "That is its surface. Structurally it is a <b>governance kernel</b>: a small, hard, "
    "dependency-free state machine whose actual product is a <b>decision record that "
    "cannot be quietly falsified</b>, wrapped in a UI pleasant enough that people will "
    "actually use it.", lead)]
story += [Paragraph(
    "The entire tree is organised around one asymmetry: <i>mutations are cheap, records "
    "are expensive to fake</i>. Every architectural decision in the repository — the "
    "single-file artifact, the injected seams, the frozen data shapes, the mutation FIFO, "
    "the SHA-256 hash chain, the boot self-check, the notary-style build, the chaos "
    "harness — exists to preserve the trustworthiness of that record on hostile ground: "
    "a browser, someone else's storage tier, an offline <font face='Courier'>file://</font> "
    "double-click, a spoofed payment webhook.", body)]

story += [Paragraph("Where the system stands today", h2)]
# metric strip
def metric_card(big, small, color=TEAL):
    return Table([[Paragraph(big, S("mbig", fontName="Helvetica-Bold", fontSize=17,
                                    leading=19, textColor=color, alignment=TA_CENTER))],
                  [Paragraph(small, S("msml", fontName="Helvetica", fontSize=7.6,
                                      leading=9.5, textColor=MUTED, alignment=TA_CENTER))]],
                 colWidths=[39 * mm])
cards = [
    metric_card("48 / 48", "verification lanes GREEN", TEAL),
    metric_card("133 / 133", "smoke assertions passing", GREEN),
    metric_card("0", "chaos findings (9 families)", STEEL),
    metric_card("163,940 B", "single-file artifact", ACCENT),
]
strip = Table([cards], colWidths=[42 * mm] * 4)
strip.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("BACKGROUND", (0, 0), (-1, -1), PANEL),
    ("BOX", (0, 0), (-1, -1), 0.8, LINE),
    ("INNERGRID", (0, 0), (-1, -1), 0.6, colors.white),
    ("TOPPADDING", (0, 0), (-1, -1), 9),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
]))
story += [strip, Spacer(1, 4),
          Paragraph("Measured on one machine from work/matrix-48-run.json "
                    "(status GREEN) and the six unit suites. Zero runtime "
                    "dependencies; the artifact refuses to boot if a single byte "
                    "of its own executable payload has been altered.", caption)]

story += [Paragraph("The one-sentence thesis", h2)]
story += [accent_panel([Paragraph(
    "&ldquo;WorldForge OS is a governance engine wearing a creative-pipeline UI: its real "
    "product is an unfakeable decision record, and every architectural choice in the tree "
    "— single-file artifact, injected seams, frozen shapes, fail-closed law, chaos suite "
    "— exists to keep that record trustworthy on hostile ground.&rdquo;", quote)],
    bar=ACCENT, fill=PANEL)]
story += [Spacer(1, 6), Paragraph(
    "The remainder of this manual makes that thesis operational: Chapter 2 lays out the "
    "four nested trust boundaries that give the record its integrity; Chapter 3 dissects "
    "the four mechanisms that defend it under concurrency, corruption, and adversarial "
    "input; Chapter 4 is the live evidence that those mechanisms hold; and Chapter 5 is an "
    "engineering vision — explicitly proposal, not record — for turning the substrate into "
    "a product.", body)]
story.append(PageBreak())

# ================================================================ 2. PHILOSOPHY
story += chapter("CHAPTER 2", "Core Philosophy — Four Nested Trust Boundaries")
story += [Paragraph(
    "Read the repository as syntax and you see a project tracker. Read it as "
    "<i>structure</i> and you see four nested trust boundaries, each less trusted than the "
    "one it wraps. Authority contracts inward; anything outward must ask permission through "
    "a mechanically-enforced seam. This is the ontology on which every guarantee rests.", body)]

boundaries = [
    ("01", "THE KERNEL", "worldforge-kernel.v1.1.js — owns mutation truth",
     "The innermost boundary and the only tier permitted to change state. Its loop is "
     "<b>freshen &rarr; mutate &rarr; ONE persist</b>. Decisions are append-only, capped, "
     "and written <i>atomically with</i> the state change they justify — you cannot move a "
     "stage and forget to say why. Gate semantics fire on <i>leaving</i> a stage: the "
     "system taxes exits, not entries, because regret is discovered late. Roughly a third "
     "of its 257 lines exist purely to guarantee that a decision record lands in the same "
     "storage write as the change it explains."),
    ("02", "THE EXT", "wfkernel-p2-ext.v1.2.js — the constitution's amendments",
     "An additive mixin only; the kernel file is never edited by it. It contributes the "
     "governance vocabulary — promotion, locking, budget, UFDM export — and, after the "
     "chaos pass, the <b>mutation FIFO</b> (D-2026-07-19-02) that makes in-process truth "
     "single-threaded. Its maintainer law is exact: a queued method must never call "
     "another queued method (deadlock); un-queued callers may call queued ones."),
    ("03", "THE COMPONENTS", "forge, roster, visual surfaces — deliberately powerless",
     "The presentation tier renders and nothing more. Forge cannot reach the kernel except "
     "through the adapter, and <font face='Courier'>build.mjs --gate</font> enforces this "
     "<i>mechanically, not by convention</i>. The override ceremony is the clearest "
     "statement of identity in the codebase: the <i>easy</i> path is refusal, and the "
     "bypass costs a name and a reason, permanently, rendered next to every clean pass. "
     "Overrides are not exceptions to governance — they are its most important records."),
    ("04", "THE NOTARY (BUILD)", "build.mjs — a notary, not a compiler",
     "The outermost boundary. No minifier, no transpiler, no tree-shaker. It performs a "
     "deterministic concat in a hand-declared order, splices the single-source kernel "
     "between <font face='Courier'>WF:KERNEL</font> markers (D-2026-07-19-01), embeds a "
     "content hash, and can re-derive it to prove freshness. It stamps per-block SHA-256 "
     "hashes so the artifact refuses to boot if its own payload was altered "
     "(D-2026-07-19-06). The artifact can prove what it is."),
]
for num, name, sub, txt in boundaries:
    header = Table([[Paragraph(num, S("bnum", fontName="Helvetica-Bold", fontSize=16,
                                      textColor=colors.white, alignment=TA_CENTER)),
                     Paragraph("<b>%s</b><br/><font size=8 color='#c9d6e0'>%s</font>"
                               % (name, sub),
                               S("bname", fontName="Helvetica-Bold", fontSize=12,
                                 textColor=colors.white, leading=15))]],
                   colWidths=[16 * mm, 152 * mm])
    header.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), ACCENT),
        ("BACKGROUND", (1, 0), (1, -1), STEEL),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (1, 0), (1, -1), 10),
    ]))
    body_tbl = panel([Paragraph(txt, body_l)], fill=PANEL, pad=10)
    story += [KeepTogether([header, body_tbl, Spacer(1, 9)])]

story += [Paragraph("The two-law discipline", h2)]
story += [Paragraph(
    "Every seam obeys one of two laws, and the codebase never confuses them:", body)]
lawtbl = Table([
    [Paragraph("FAIL-CLOSED", cell_h), Paragraph("Everywhere money or governance is "
     "involved. Corrupt rows abort billing; unrecordable overrides do not happen; an "
     "ambiguous gateway response is <i>unpaid</i>, never assumed paid. When the system "
     "cannot be sure it is safe, it stops.", cell)],
    [Paragraph("FAIL-LOUD", cell_h), Paragraph("Everywhere recovery is possible. Corrupt "
     "entries skip with events and console noise, never silently; a corrupt primary read "
     "auto-rolls-back with provenance. When the system can proceed safely, it does — but "
     "it always leaves a trace.", cell)],
], colWidths=[34 * mm, 134 * mm])
lawtbl.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (0, 0), RED),
    ("BACKGROUND", (0, 1), (0, 1), TEAL),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("BOX", (0, 0), (-1, -1), 0.8, LINE),
    ("INNERGRID", (0, 0), (-1, -1), 0.6, LINE),
    ("TOPPADDING", (0, 0), (-1, -1), 8),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ("LEFTPADDING", (0, 0), (-1, -1), 9),
    ("RIGHTPADDING", (0, 0), (-1, -1), 9),
]))
story += [lawtbl, Spacer(1, 8)]

story += [Paragraph("Frozen invariants", h3),
          Paragraph("Violating any of these is an identity change, not a bug:", body_l),
          bullets([
    "One storage write per mutation; the record lands with the change.",
    "Ledger entries carry <font face='Courier'>cost</font> — <font face='Courier'>amount</font> is a detected, rejected shape.",
    "Fail-closed everywhere money or governance is involved.",
    "Fail-loud everywhere recovery is possible.",
    "Vanilla JS + WAAPI, UMD, zero runtime dependencies (D-2026-07-18-04). The artifact must survive a <font face='Courier'>file://</font> double-click on an offline machine.",
    "The chaos suite is part of the product. A fix without a probe is a rumor.",
])]
story.append(PageBreak())

# ================================================================ 3. DEEP DIVE
story += chapter("CHAPTER 3", "Technical Deep-Dive")
story += [Paragraph(
    "Four mechanisms defend the record under the conditions that would otherwise corrupt "
    "it: concurrency, corruption-at-rest, historical tampering, and adversarial payment "
    "input. Each is a self-contained module with its own smoke suite; each was added in "
    "response to a specific, reproduced failure.", body)]

# --- 3.1 Mutation FIFO
story += [Paragraph("3.1  The Mutation FIFO", h2),
          Paragraph("<i>Source: wfkernel-p2-ext.v1.2.js · Ratified D-2026-07-19-02 · "
                    "Chaos findings 3 &amp; 4</i>", caption)]
story += [Paragraph(
    "The kernel's <font face='Courier'>freshen()</font> replaces the in-memory state "
    "object before a mutation is applied. Under concurrency this opens a lost-write "
    "window: a racing <font face='Courier'>advance()</font> and "
    "<font face='Courier'>updateBudget()</font> each hold a reference to a different "
    "snapshot, and the last persist silently wins. The fuzz harness reproduced it "
    "(finding 3); a browser first-use race reproduced it live (finding 4) — an in-flight "
    "<font face='Courier'>loadProjects()</font> wholesale-replaced the array and wiped a "
    "concurrent <font face='Courier'>createProject()</font>; the user saw &lsquo;Save "
    "failed&rsquo; and a new project vanished.", body)]
story += [Paragraph(
    "The immunity is a single <b>in-process FIFO</b> installed by the ext, wrapping all "
    "twelve state-replacing operations so they serialise through one queue. Cross-client "
    "semantics are unchanged (freshen, last-writer-wins); only <i>in-process</i> truth "
    "becomes single-threaded. The queue seam is exposed to sibling extensions as "
    "<font face='Courier'>kernel._p2Enqueue</font>, which the monetization layer joins so "
    "meter writes cannot re-create the race. The maintainer law — a queued method must "
    "never call another queued method — is what keeps the single thread from "
    "dead-locking on itself.", body)]

# --- 3.2 Recovery G1
story += [Paragraph("3.2  Gap&nbsp;1 — Automated State Recovery", h2),
          Paragraph("<i>Source: src/wf-recovery.v1.js · Ratified D-2026-07-19-04 · "
                    "closes gap G1</i>", caption)]
story += [Paragraph(
    "Before this tier, corruption-at-rest was detected loudly (kernel 1.1.1) but the data "
    "was simply lost — <b>detection without restitution</b>. G1 was sequenced first "
    "because it is the only gap where the system <i>knew</i> it had lost user data and "
    "could do nothing about it. The layer closes it at the storage seam: it wraps the "
    "injected adapter, so the kernel, ext, and monetization tiers are untouched.", body)]
rec = Table([
    [Paragraph("WRITE", cell_h),
     Paragraph("A guarded key's value must parse as a JSON object or the write "
               "<b>throws</b> — fail-closed, a corrupt transaction never lands. After the "
               "primary persists, a hash-stamped shadow copy is written: "
               "<font face='Courier'>{ h, v, ts }</font>, the last pristine state-hash "
               "the system can always fall back to.", cell)],
    [Paragraph("READ", cell_h),
     Paragraph("A guarded primary that fails to parse triggers auto-rollback: the "
               "shadow's hash is re-verified first (<b>a tampered shadow is refused, never "
               "restored</b>), the primary is rewritten from the shadow, the event is loud "
               "(console + <font face='Courier'>onEvent</font>), and the caller "
               "transparently receives the recovered state. No shadow, or shadow tampered "
               "&rarr; loud null. Recovery never guesses.", cell)],
], colWidths=[22 * mm, 146 * mm])
rec.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (0, -1), STEEL),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("BOX", (0, 0), (-1, -1), 0.8, LINE),
    ("INNERGRID", (0, 0), (-1, -1), 0.6, LINE),
    ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
]))
story += [rec, Spacer(1, 4),
          Paragraph("Hashing is FNV-1a 32-bit, synchronous and dependency-free: this tier "
                    "provides <b>integrity</b> provenance (bit-rot, truncation, partial "
                    "writes), not cryptographic tamper-proofing. That distinction is "
                    "deliberate — cryptographic chaining is the next mechanism.", caption)]

# --- 3.3 Event chain G2
story += [Paragraph("3.3  Gap&nbsp;2 — The SHA-256 Event Chain", h2),
          Paragraph("<i>Source: src/wf-event-chain.v1.js · Ratified D-2026-07-19-05 · "
                    "closes PROV-1</i>", caption)]
story += [Paragraph(
    "The decision log is append-only <i>by discipline</i>, not by math — a hostile storage "
    "tier could rewrite history. G2 makes the governance ledger <b>tamper-evident</b>: "
    "every appended decision is hash-chained to its predecessor via "
    "<font face='Courier'>_chain = { seq, prev, hash }</font>, so altering, reordering, "
    "deleting, or inserting any historical record breaks "
    "<font face='Courier'>verifyEventChain()</font> at the exact index of tampering. It "
    "was verified against Node's crypto on 13 vectors, including multi-block inputs and "
    "surrogate pairs.", body)]
story += [accent_panel([Paragraph(
    "<b>Why a hand-written SHA-256.</b> The module contains 158 lines of pure-JS "
    "bit-twiddling for one reason: the kernel's record-append path is <i>synchronous</i>, "
    "and browser SubtleCrypto is async-only, so it cannot back a sync append. The system "
    "would rather implement a hash function than let a governance record be appended "
    "without provenance. The chain fields are excluded from the digest, so a record's hash "
    "never depends on itself.", body_l)], bar=TEAL, fill=PANEL2)]
story += [Paragraph(
    "<b>Honest scope (frozen with the decision):</b> this is keyless tamper-<i>evidence</i>. "
    "It proves history was not altered by anyone who does not also rewrite the whole chain "
    "forward; an attacker who controls all bytes could recompute the entire chain. Keyed, "
    "signed authenticity is a further step, tracked as marker <font face='Courier'>PROV-2"
    "</font>. The value delivered today is that <i>any partial edit is caught</i>.", body)]

# --- 3.4 Payment bridge MON-1
story += [Paragraph("3.4  The MON-1 Server Payment Bridge", h2),
          Paragraph("<i>Source: src/wf-payment-bridge.v1.js (server-side) + "
                    "src/wf.monetization.v1.js (contract) · D-2026-07-19-03</i>", caption)]
story += [Paragraph(
    "The payment bridge is <b>server-side only</b> and deliberately absent from the "
    "<font face='Courier'>build.mjs</font> bundle manifest — the offline artifact's "
    "isolation is untouched. It is the verification and provenance half of a payment "
    "integration, and it is careful to be no more than that.", body)]
story += [bullets([
    "<b>verifySignature</b> — Stripe-scheme webhook authentication: header "
    "<font face='Courier'>t=&lt;unix&gt;,v1=&lt;hex&gt;</font>, HMAC-SHA256 over "
    "<font face='Courier'>${t}.${rawBody}</font>, constant-time compare, bounded "
    "timestamp tolerance (replay window, 300&nbsp;s).",
    "<b>normalizeProcessorEvent</b> — translates processor vocabulary into the frozen "
    "ledger vocabulary: money lands as <font face='Courier'>cost</font> in major units; "
    "<font face='Courier'>amount</font> is processor dialect and never survives into a record.",
    "<b>ingest</b> — appends a <font face='Courier'>payment-verified</font> governance "
    "record through the kernel's <font face='Courier'>recordDecision</font> channel, so it "
    "is hash-chained by the G2 event chain and persisted exactly once.",
])]
story += [accent_panel([Paragraph(
    "<b>What it is NOT.</b> It moves no money, calls no processor API, and holds no card "
    "data. It only proves &lsquo;a correctly-signed webhook arrived and was recorded "
    "immutably&rsquo;. The default monetization gateway is a <b>MOCK</b>; no real payment "
    "processing exists anywhere in this codebase. Charging remains behind the "
    "<font face='Courier'>MON-1</font> real-gateway decision, which has not been recorded.",
    body_l)], bar=RED, fill=colors.HexColor("#f7efec"))]
story += [Paragraph("Its fail-closed law is enumerated as a probed error register — every "
                    "clause is exercised in <font face='Courier'>test/payment-bridge-smoke.mjs"
                    "</font> and fuzzed in the chaos harness:", body)]
paytbl = Table([
    [Paragraph("Code", cell_h), Paragraph("Fail-closed clause", cell_h)],
    [Paragraph("PAY-01", cell_mono), Paragraph("No secret configured — nothing verifies", cell)],
    [Paragraph("PAY-02", cell_mono), Paragraph("Malformed signature header", cell)],
    [Paragraph("PAY-03", cell_mono), Paragraph("Timestamp outside tolerance — replay refused", cell)],
    [Paragraph("PAY-04", cell_mono), Paragraph("HMAC mismatch", cell)],
    [Paragraph("PAY-05", cell_mono), Paragraph("Event without id / type", cell)],
    [Paragraph("PAY-06", cell_mono), Paragraph("Ambiguous money — never guessed", cell)],
    [Paragraph("PAY-07", cell_mono), Paragraph("Duplicate event id — idempotent, ledger untouched", cell)],
], colWidths=[24 * mm, 144 * mm])
paytbl.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), RED),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PANEL]),
    ("BOX", (0, 0), (-1, -1), 0.8, LINE),
    ("LINEBELOW", (0, 0), (-1, 0), 0.8, LINE),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ("LEFTPADDING", (0, 0), (-1, -1), 9),
]))
story += [paytbl, Spacer(1, 4),
          Paragraph("The server-governance telemetry in the archive shows the whole path "
                    "working end-to-end: a verified <font face='Courier'>evt_demo_001</font> "
                    "(payment_intent.succeeded, cost 49.99 USD) recorded as a hash-chained "
                    "<font face='Courier'>payment-verified</font> decision at chain seq 0.", caption)]
story.append(PageBreak())

# ================================================================ 4. SCOREBOARD
story += chapter("CHAPTER 4", "Operational Verification Scoreboard")
story += [Paragraph(
    "This chapter is the live evidence that the mechanisms of Chapter 3 hold. Every figure "
    "is copied from measured telemetry in the archive. The headline is the 48-lane "
    "verification matrix; beneath it sit the six unit suites (133 assertions) and the "
    "chaos immunity record.", body)]

story += [accent_panel([Paragraph(
    "<b>Honesty contract (from scripts/agent-matrix-48.mjs).</b> The 48 &lsquo;lanes&rsquo; "
    "are a <b>local parallel job runner on one machine</b> — 48 real micro-jobs (real "
    "subprocesses and real file assertions reporting real exit codes), <i>not</i> 48 "
    "compute nodes and not a distributed or decentralized architecture. No model calls, no "
    "network, no remote compute. WorldForge OS remains a single self-contained HTML "
    "artifact by design. Cluster names are organisational labels for related jobs.",
    body_l)], bar=ACCENT, fill=PANEL)]

story += [Paragraph("4.1  The 48-lane matrix — by cluster", h2)]
mat = Table([
    [Paragraph("Cluster", cell_h), Paragraph("Focus", cell_h),
     Paragraph("Lanes", cell_h), Paragraph("Green", cell_h)],
    [Paragraph("Engine Core", cell_b), Paragraph("kernel / ext / billing / recovery contracts + syntax + bundle hash", cell), Paragraph("10", cell), Paragraph("10 ✓", cell_b)],
    [Paragraph("Crypto &amp; Red-Team", cell_b), Paragraph("event chain, payment webhook bridge, chaos harness, scope confinement, suite integrity", cell), Paragraph("12", cell), Paragraph("12 ✓", cell_b)],
    [Paragraph("Perf &amp; WAAPI", cell_b), Paragraph("render-path syntax, artifact weight budget, WAAPI / rAF leak checks", cell), Paragraph("10", cell), Paragraph("10 ✓", cell_b)],
    [Paragraph("Hygiene &amp; Linters", cell_b), Paragraph("rules matrix freshness, roster + schema lint, TODO sweep, orchestrator syntax", cell), Paragraph("8", cell), Paragraph("8 ✓", cell_b)],
    [Paragraph("Branding &amp; Telemetry", cell_b), Paragraph("collateral presence, identity thesis, ratified decision log, telemetry parse", cell), Paragraph("8", cell), Paragraph("8 ✓", cell_b)],
    [Paragraph("TOTAL", cell_b), Paragraph("status GREEN", cell_b), Paragraph("48", cell_b), Paragraph("48 ✓", cell_b)],
], colWidths=[34 * mm, 96 * mm, 18 * mm, 20 * mm])
mat.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), TEAL),
    ("BACKGROUND", (0, -1), (-1, -1), PANEL2),
    ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, PANEL]),
    ("BOX", (0, 0), (-1, -1), 0.9, LINE),
    ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
    ("LINEABOVE", (0, -1), (-1, -1), 1.0, TEAL),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("ALIGN", (2, 0), (3, -1), "CENTER"),
    ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("TEXTCOLOR", (3, 1), (3, -2), GREEN),
    ("TEXTCOLOR", (3, -1), (3, -1), GREEN),
]))
story += [mat, Spacer(1, 4),
          Paragraph("Run telemetry (work/matrix-48-run.json): concurrency 8 · wall "
                    "3,675&nbsp;ms · serial-equivalent 20,642&nbsp;ms · <b>5.62&times; "
                    "speed-up</b> · artifact 163,940&nbsp;B · status <b>GREEN</b>. "
                    "Every ✓ is an exit-code-0 you can reproduce by running the job "
                    "yourself.", caption)]

story += [Paragraph("4.2  The 133 smoke assertions — six unit suites", h2)]
sm = Table([
    [Paragraph("Suite", cell_h), Paragraph("Covers", cell_h), Paragraph("Passed", cell_h)],
    [Paragraph("kernel-smoke.mjs", cell_mono), Paragraph("kernel contract: atomic record+mutation, gate-on-leaving, loud corrupt-skip", cell), Paragraph("30 / 30", cell_b)],
    [Paragraph("p2-ext-smoke.mjs", cell_mono), Paragraph("ext v1.2.1: 21 baseline + 6 read-seams + 4 chaos regressions (incl. FIFO)", cell), Paragraph("31 / 31", cell_b)],
    [Paragraph("payment-bridge-smoke.mjs", cell_mono), Paragraph("MON-1 bridge: HMAC auth, replay window, normalization, idempotency (PAY-01..07)", cell), Paragraph("25 / 25", cell_b)],
    [Paragraph("monetization-smoke.mjs", cell_mono), Paragraph("billing contract: meter writes, corrupt-row abort, tamper-checked invoicing", cell), Paragraph("20 / 20", cell_b)],
    [Paragraph("event-chain-smoke.mjs", cell_mono), Paragraph("G2 chain: SHA-256 vectors, break-index on edit / delete / reorder / insert", cell), Paragraph("16 / 16", cell_b)],
    [Paragraph("recovery-smoke.mjs", cell_mono), Paragraph("G1 recovery: shadow stamping, auto-rollback, forged-shadow refusal", cell), Paragraph("11 / 11", cell_b)],
    [Paragraph("TOTAL", cell_b), Paragraph("six suites, zero failures", cell_b), Paragraph("133 / 133", cell_b)],
], colWidths=[46 * mm, 96 * mm, 26 * mm])
sm.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), STEEL),
    ("BACKGROUND", (0, -1), (-1, -1), PANEL2),
    ("ROWBACKGROUNDS", (0, 1), (-1, -2), [colors.white, PANEL]),
    ("BOX", (0, 0), (-1, -1), 0.9, LINE),
    ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
    ("LINEABOVE", (0, -1), (-1, -1), 1.0, STEEL),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("ALIGN", (2, 0), (2, -1), "CENTER"),
    ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("TEXTCOLOR", (2, 1), (2, -1), GREEN),
]))
story += [sm, Spacer(1, 4),
          Paragraph("30 + 31 + 25 + 20 + 16 + 11 = 133. Counts cross-checked against the "
                    "jarvis-run and matrix-48 telemetry tails in the archive.", caption)]

story += [Paragraph("4.3  Chaos immunity — five reproduced failures, all fixed", h2)]
story += [Paragraph(
    "The chaos suite is treated as part of the product: <i>a fix without a probe is a "
    "rumor</i>. Every failure below was reproduced, patched, and turned into a permanent "
    "regression probe. Nine probe families now run with zero findings.", body)]
ch = Table([
    [Paragraph("Sev", cell_h), Paragraph("Failure mode", cell_h), Paragraph("Immunity", cell_h)],
    [Paragraph("CRIT", cell_b), Paragraph("One null row in budget_ledger crashed getBudgetSummary() — whole budget UI dead from one corrupt row", cell), Paragraph("Corrupt rows counted &amp; console-errored, never fatal", cell)],
    [Paragraph("HIGH", cell_b), Paragraph("reserveBudget wrote {amount} — the frozen-shape violation; reservations invisible, burnstrip rendered NaN", cell), Paragraph("Writes {cost, ts}; legacy amount honored on read", cell)],
    [Paragraph("HIGH", cell_b), Paragraph("Racing advance() vs updateBudget() lost ledger writes — freshen replaced the object mid-flight", cell), Paragraph("Global in-process mutation FIFO (12 ops)", cell)],
    [Paragraph("HIGH", cell_b), Paragraph("First-use race: in-flight loadProjects() wiped a concurrent createProject() — new project vanished", cell), Paragraph("Same FIFO — load / create serialized with mutators", cell)],
    [Paragraph("MED", cell_b), Paragraph("Corrupt project entry skipped silently on load — a project vanishes with no trace (fail-open)", cell), Paragraph("Loud skip: console.error + event + corrupt count (kernel 1.1.1)", cell)],
], colWidths=[14 * mm, 92 * mm, 62 * mm])
ch.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#6b4a2a")),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PANEL]),
    ("BOX", (0, 0), (-1, -1), 0.9, LINE),
    ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("ALIGN", (0, 0), (0, -1), "CENTER"),
    ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
    ("TEXTCOLOR", (0, 1), (0, -1), RED),
]))
story += [ch, Spacer(1, 4),
          Paragraph("Probes that survived unpatched: overdraw refusal, chained kernel+ext "
                    "eventing, hostile-listener containment, and global scope confined to "
                    "exactly the six expected UMD names. Boot self-check negative-tested "
                    "live: kernel-block and bundle-block tampers both refused with "
                    "block-precise diagnostics.", caption)]
story.append(PageBreak())

# ================================================================ 5. ROADMAP
story += chapter("CHAPTER 5", "The Strategic Roadmap")
story += [accent_panel([Paragraph(
    "<b>Status of this chapter: proposal, not record.</b> Everything below is engineering "
    "judgment developed from the review. Nothing here has been ratified, and several items "
    "would require decision records in <font face='Courier'>docs/decision_log.md</font> "
    "before implementation. It is kept distinct from the measured chapters on purpose — "
    "the whole system exists to keep proposal and record from being confused.",
    body_l)], bar=STEEL, fill=PANEL)]

story += [Paragraph("5.1  The strategic observation", h2)]
story += [Paragraph(
    "The most valuable thing in this repository is not the pipeline tracker. It is the "
    "<b>governance substrate</b>: kernel + ext + recovery + event chain + boot self-check + "
    "chaos harness — roughly 55&nbsp;KB of dependency-free JavaScript providing "
    "atomic record-with-mutation, tamper-evident history, self-healing storage, and "
    "artifact self-verification, with a documented seam architecture and an honest "
    "statement of its own limits. That substrate has <i>nothing to do with film "
    "production</i>. The ten stages, three gates, and eight guilds are configuration.", body)]
story += [Paragraph(
    "Any domain where an irreversible decision needs an attributable, verifiable record "
    "has the same shape:", body_l),
    bullets([
        "Clinical-trial protocol deviations",
        "Model-deployment approvals in regulated ML",
        "Change-advisory boards in regulated infrastructure",
        "Financial close and journal-entry approvals",
        "Legal matter management",
        "Aviation and industrial maintenance sign-offs",
        "Academic research integrity and provenance",
        "Supply-chain custody transfers",
    ])]
story += [accent_panel([Paragraph(
    "<b>Recommendation P0 — extract <font face='Courier'>@worldforge/governance-kernel</font>.</b> "
    "The seams already exist: pipeline, roster, rules, storage, actor, and digest are all "
    "injected. Extraction is packaging and documentation, not re-architecture. WorldForge "
    "OS then becomes the reference implementation and the flagship demo. This is the "
    "single highest-leverage move available — the codebase has already done ninety percent "
    "of the work.", body_l)], bar=ACCENT, fill=PANEL2)]

story += [Paragraph("5.2  Closing the tracked gaps — proposed order", h2)]
gap = Table([
    [Paragraph("Marker", cell_h), Paragraph("Move", cell_h), Paragraph("Why it matters", cell_h)],
    [Paragraph("TEN-1", cell_mono), Paragraph("Multi-tenant key derived at kernel construction, enforced at the adapter via a new --tenantcheck gate", cell), Paragraph("The commercial unlock — nothing enterprise-shaped ships without it", cell)],
    [Paragraph("CAS-1", cell_mono), Paragraph("Optional setIfVersion capability the recovery wrapper probes for; degrade to LWW and say so via kernel.concurrencyMode", cell), Paragraph("The correctness gap — make the guarantee legible, never fake it", cell)],
    [Paragraph("PROV-2", cell_mono), Paragraph("Optional signing seam over the existing chain head (Ed25519 in-browser, HSM/KMS server-side)", cell), Paragraph("Keyed authenticity; keyless chain stays the default fallback", cell)],
    [Paragraph("ACT-1", cell_mono), Paragraph("pipeline.actorPolicy: free | roster | roster-or-human, default unchanged", cell), Paragraph("Enterprises wire roster to SSO; solo users keep free text", cell)],
], colWidths=[20 * mm, 82 * mm, 66 * mm])
gap.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), STEEL),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PANEL]),
    ("BOX", (0, 0), (-1, -1), 0.9, LINE),
    ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
]))
story += [gap, Spacer(1, 8)]

story += [Paragraph("5.3  New capabilities worth building", h2)]
story += [bullets([
    "<b>Decision-record archival</b> — roll evicted decisions into a hash-anchored archive "
    "instead of discarding at cap-100. Removes the only place the record is silently made "
    "less complete (~40 lines, a correctness issue not a feature).",
    "<b>The Audit Bundle</b> — a single self-contained HTML file carrying the full decision "
    "chain, an embedded browser verifier, the exact kernel/artifact hashes, and a "
    "plain-language integrity verdict. The natural commercial artifact of this architecture; "
    "needs no new trust machinery.",
    "<b>Server-side recovery parity</b> — wrap server.js fileStorage with WFRecovery and "
    "make flush() crash-atomic (tmp &rarr; fsync &rarr; rename). Closes a real truncation "
    "window in ~5 lines.",
    "<b>Gate analytics</b> — override rate per gate, time-in-stage, reversal depth. The key "
    "insight: override rate is a signal about the <i>gate</i>, not the people — it "
    "distinguishes an undisciplined team from a mis-placed checkpoint.",
    "<b>Storage adapters as a published set</b> — localStorage, IndexedDB, Node file, "
    "S3/R2, Postgres, in-memory — each with its own smoke suite. Adapters are the adoption "
    "surface; IndexedDB / S3 / Postgres also unlock real CAS.",
    "<b>Time-travel replay</b> — kernel.replayTo(seq) returning a read-only projection of "
    "state as it stood at any decision index. The append-only, hash-chained data model "
    "already supports it; nothing exposes it yet.",
])]

story += [Paragraph("5.4  The deliberate anti-roadmap", h2)]
story += [Paragraph("Discipline is easier to lose than to build. Three things this system "
                    "should refuse to do, because each would trade away the property that "
                    "makes it valuable:", body)]
anti = Table([
    [Paragraph("Do NOT add a framework", cell_b), Paragraph("The zero-dependency constraint is what makes the artifact auditable and offline-capable. Every dependency is a trust delegation.", cell)],
    [Paragraph("Do NOT minify", cell_b), Paragraph("Byte-shredding would fight the audit discipline that caught these bugs. The comments are load-bearing — several encode invariants that exist nowhere else.", cell)],
    [Paragraph("Do NOT go multi-file", cell_b), Paragraph("One file that hashes itself is the trust model. Splitting it forfeits boot self-verification.", cell)],
], colWidths=[42 * mm, 126 * mm])
anti.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#7a2f26")),
    ("TEXTCOLOR", (0, 0), (0, -1), colors.white),
    ("ROWBACKGROUNDS", (1, 0), (1, -1), [colors.white, PANEL]),
    ("BOX", (0, 0), (-1, -1), 0.8, LINE),
    ("INNERGRID", (0, 0), (-1, -1), 0.6, LINE),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ("LEFTPADDING", (0, 0), (-1, -1), 9), ("RIGHTPADDING", (0, 0), (-1, -1), 9),
    ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
]))
story += [anti]
story.append(PageBreak())

# ================================================================ APPENDIX
story += chapter("APPENDIX", "Decision Log, Error Register & Inventory")
story += [Paragraph("A.1  Ratified decision records", h3),
          Paragraph("Append-only. Ratification authority: Irfan. A decision with real "
                    "weight gets recorded, not just decided (Rule 7).", caption)]
dl = Table([
    [Paragraph("Record", cell_h), Paragraph("Ratified decision", cell_h)],
    [Paragraph("D-…-18-04", cell_mono), Paragraph("Engineering language: Vanilla JS + WAAPI, UMD, zero build-chain dependencies.", cell)],
    [Paragraph("D-…-19-01", cell_mono), Paragraph("Kernel single-source splice — build.mjs folds the kernel into the determinism hash.", cell)],
    [Paragraph("D-…-19-02", cell_mono), Paragraph("In-process mutation FIFO — all state-replacing ops serialize through one queue.", cell)],
    [Paragraph("D-…-19-03", cell_mono), Paragraph("Monetization contract v1 — frozen billing contract, mock gateway, bundle-excluded.", cell)],
    [Paragraph("D-…-19-04", cell_mono), Paragraph("Recovery tier at the storage seam — hash-stamped shadows, loud auto-rollback.", cell)],
    [Paragraph("D-…-19-05", cell_mono), Paragraph("Cryptographic event chain (G2 / PROV-1) — SHA-256 hash-chained governance records.", cell)],
    [Paragraph("D-…-19-06", cell_mono), Paragraph("Artifact boot self-check (G5 / SELF-1) — refuses to boot on per-block hash mismatch.", cell)],
], colWidths=[24 * mm, 144 * mm])
dl.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), STEEL),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PANEL]),
    ("BOX", (0, 0), (-1, -1), 0.8, LINE),
    ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
]))
story += [dl, Spacer(1, 8)]

story += [Paragraph("A.2  Open markers (not yet ratified)", h3),
          Paragraph("<font face='Courier'>MON-1</font> real-gateway decision · "
                    "<font face='Courier'>PROV-2</font> keyed/signed authenticity · "
                    "<font face='Courier'>TEN-1</font> multi-tenant prefixes · "
                    "<font face='Courier'>CAS-1</font> storage-tier compare-and-swap · "
                    "<font face='Courier'>PIPE-1</font> · <font face='Courier'>ACT-1</font> · "
                    "<font face='Courier'>UFDM2-Q1–Q3</font> · §5–6 browser/a11y release "
                    "passes (Irfan-side).", body_l)]

story += [Paragraph("A.3  Measured inventory", h3)]
inv = Table([
    [Paragraph("Metric", cell_h), Paragraph("Value", cell_h), Paragraph("Source", cell_h)],
    [Paragraph("Shipped artifact size", cell), Paragraph("163,940 B", cell_b), Paragraph("matrix-48-run.json", cell_mono)],
    [Paragraph("Monolith baseline", cell), Paragraph("653,674 B", cell_b), Paragraph("chaos-report", cell_mono)],
    [Paragraph("Reduction vs monolith", cell), Paragraph("~74.9%", cell_b), Paragraph("branding regen", cell_mono)],
    [Paragraph("Runtime dependencies", cell), Paragraph("0", cell_b), Paragraph("D-…-18-04", cell_mono)],
    [Paragraph("Global UMD names", cell), Paragraph("6 (confined)", cell_b), Paragraph("scope gate", cell_mono)],
    [Paragraph("Matrix wall time / speed-up", cell), Paragraph("3,675 ms · 5.62×", cell_b), Paragraph("matrix-48-run.json", cell_mono)],
], colWidths=[62 * mm, 46 * mm, 60 * mm])
inv.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), TEAL),
    ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PANEL]),
    ("BOX", (0, 0), (-1, -1), 0.8, LINE),
    ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
]))
story += [inv, Spacer(1, 12)]
story += [rule(LINE, 0.8, space_after=8)]
story += [Paragraph(
    "<i>End of manual. Compiled locally with ReportLab from the WorldForge OS full source "
    "archive. This document reproduces the system's own stated limits — the payment "
    "gateway is a mock, the 48 lanes are a local job runner, and the event chain is "
    "keyless tamper-evidence — because a manual that overstated the guarantees would "
    "violate the very identity it documents.</i>", caption)]

# ---------------------------------------------------------------- build
os.makedirs(os.path.dirname(OUT), exist_ok=True)
doc = Manual(OUT, pagesize=A4,
             title="WorldForge OS — Master Manual",
             author="WorldForge OS", subject="Trust & Governance Architecture")
doc.addPageTemplates([
    PageTemplate(id="cover", frames=[COVER_FRAME], onPage=cover_bg),
    PageTemplate(id="content", frames=[FRAME], onPage=content_page),
])
doc.build(story)
print("WROTE", OUT, os.path.getsize(OUT), "bytes")
