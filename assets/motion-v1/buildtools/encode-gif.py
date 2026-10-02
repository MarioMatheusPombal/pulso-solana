#!/usr/bin/env python3
"""Encode a 48-frame RGBA directory as a precise four-second 12fps GIF preview."""
import argparse
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('frame_dir', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
frames = []
for source in sorted(args.frame_dir.glob('*.png')):
    image = Image.open(source).convert('RGBA')
    image.thumbnail((480, 480))
    frames.append(image.convert('P', palette=Image.Palette.ADAPTIVE))
if len(frames) != 48:
    raise SystemExit(f'expected 48 frames, found {len(frames)}')
durations = [80 if index % 3 != 2 else 90 for index in range(48)]
frames[0].save(args.output, save_all=True, append_images=frames[1:], duration=durations,
               loop=0, optimize=False, disposal=2)
