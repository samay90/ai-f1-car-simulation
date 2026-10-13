#!/usr/bin/env python3
"""Generate a random wide car track and export it as JSON rows.

JSON format:
[
  "0000000000",
  "0011111000",
  "0000000000"
]

Each string is one grid row: '0' = wall, '1' = drivable road.
Dependencies: pip install numpy pillow
"""

import argparse
import json
import random
from collections import deque

import numpy as np
from PIL import Image, ImageDraw


def smooth_path(points, samples_per_segment=20):
    result = []
    for i in range(len(points) - 1):
        p0 = points[max(i - 1, 0)]
        p1, p2 = points[i], points[i + 1]
        p3 = points[min(i + 2, len(points) - 1)]

        for step in range(samples_per_segment):
            t = step / samples_per_segment
            t2, t3 = t * t, t * t * t
            x = 0.5 * (
                2 * p1[0] + (-p0[0] + p2[0]) * t
                + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
            )
            y = 0.5 * (
                2 * p1[1] + (-p0[1] + p2[1]) * t
                + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
            )
            result.append((round(x), round(y)))

    result.append(tuple(map(int, points[-1])))
    return result


def all_road_connected(grid, start_xy, finish_xy):
    h, w = grid.shape
    sx, sy = start_xy
    fx, fy = finish_xy
    seen = np.zeros((h, w), dtype=bool)
    if grid[sy, sx] != 1 or grid[fy, fx] != 1:
        return False

    queue = deque([(sy, sx)])
    seen[sy, sx] = True
    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and grid[ny, nx] == 1 and not seen[ny, nx]:
                seen[ny, nx] = True
                queue.append((ny, nx))
    return seen[fy, fx] and np.array_equal(seen, grid == 1)


def generate_track(size=1000, track_width=90, border=12, seed=None, attempts=100):
    if size < 100:
        raise ValueError("size must be at least 100")
    if track_width < 12 or track_width >= size // 3:
        raise ValueError("track_width must be at least 12 and less than size/3")
    if border < 1 or border + track_width // 2 + 5 >= size // 2:
        raise ValueError("border is too large for this grid")

    rng = random.Random(seed)
    margin = border + track_width // 2 + 5

    for _ in range(attempts):
        count = max(7, size // 105)
        xs = np.linspace(margin, size - margin - 1, count).astype(int).tolist()
        ys = []
        for i in range(count):
            target = rng.randint(int(size * 0.22), int(size * 0.78))
            if i == 0:
                y = rng.randint(int(size * 0.35), int(size * 0.65))
            else:
                y = round(0.58 * ys[-1] + 0.42 * target)
                y = max(margin, min(size - margin - 1, y))
            ys.append(y)

        centerline = smooth_path(list(zip(xs, ys)))
        valid = True
        min_dist = track_width * 1.25
        for i in range(len(centerline)):
            for j in range(i + 35, len(centerline), 10):
                dx = centerline[i][0] - centerline[j][0]
                dy = centerline[i][1] - centerline[j][1]
                if dx * dx + dy * dy < min_dist * min_dist:
                    valid = False
                    break
            if not valid:
                break
        if not valid:
            continue

        image = Image.new("L", (size, size), 0)
        draw = ImageDraw.Draw(image)
        draw.line(centerline, fill=1, width=track_width, joint="curve")
        radius = track_width // 2
        for x, y in (centerline[0], centerline[-1]):
            draw.ellipse((x-radius, y-radius, x+radius, y+radius), fill=1)

        grid = np.asarray(image, dtype=np.uint8).copy()
        grid[:border, :] = 0
        grid[-border:, :] = 0
        grid[:, :border] = 0
        grid[:, -border:] = 0

        start, finish = centerline[0], centerline[-1]
        if all_road_connected(grid, start, finish):
            return grid, start, finish

    raise RuntimeError("Could not generate a connected track. Try a smaller --width or another --seed.")


def save_json_rows(grid, filename):
    """Export as a JSON array of row strings, e.g. ['01001', '11100']."""
    rows = ["".join("1" if cell else "0" for cell in row) for row in grid]
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(rows, f, separators=(",", ":"))
        f.write("\n")


def save_preview(grid, start, finish, filename):
    h, w = grid.shape
    preview = Image.new("RGB", (w, h), (28, 31, 36))
    pixels = preview.load()
    for y in range(h):
        for x in range(w):
            if grid[y, x]:
                pixels[x, y] = (225, 230, 235)
    draw = ImageDraw.Draw(preview)
    radius = max(4, min(10, w // 100))
    for (x, y), color in ((start, (40, 190, 100)), (finish, (220, 70, 70))):
        draw.ellipse((x-radius, y-radius, x+radius, y+radius), fill=color)
    preview.save(filename)


def main():
    parser = argparse.ArgumentParser(description="Generate a random car track as JSON row strings.")
    parser.add_argument("--size", type=int, default=1000, help="Grid height and width (default: 1000)")
    parser.add_argument("--width", type=int, default=50, help="Road width (default: 90)")
    parser.add_argument("--border", type=int, default=20, help="Wall border thickness (default: 12)")
    parser.add_argument("--seed", type=int, default=None, help="Seed for reproducible output")
    parser.add_argument("--output", default="track.json", help="Output JSON filename")
    parser.add_argument("--preview", default=None, help="Optional preview image filename")
    args = parser.parse_args()

    grid, start, finish = generate_track(args.size, args.width, args.border, args.seed)
    save_json_rows(grid, args.output)
    if args.preview:
        save_preview(grid, start, finish, args.preview)
    with open("terminals.json", "w", encoding="utf-8") as file:
        file.write("{")
        file.write(f'"start": [{start[0]}, {start[1]}],')
        file.write(f'"finish": [{finish[0]}, {finish[1]}]')
        file.write("}")


    print(f"Saved {args.output}: {args.size} row strings, {args.size} bits per row")
    print(f"Start (x, y): {start}; finish (x, y): {finish}")
    print(f"Road cells: {int(grid.sum())}; wall cells: {grid.size - int(grid.sum())}")
    if args.preview:
        print(f"Saved preview: {args.preview}")


if __name__ == "__main__":
    main()
