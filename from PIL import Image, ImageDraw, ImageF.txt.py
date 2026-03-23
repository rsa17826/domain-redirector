import os
import math
from PIL import Image, ImageDraw

def make_icon(size):
    # Create transparent background
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. Background: Dark rounded rectangle
    margin = size * 0.1
    radius = size * 0.2
    draw.rounded_rectangle(
        [margin, margin, size - margin, size - margin], 
        radius=radius, 
        fill=(22, 27, 34, 255)
    )

    # 2. Geometry Setup
    cx, cy = size / 2, size / 2
    arc_radius = size * 0.22
    line_width = max(2, int(size * 0.1)) # Thicker line for better visibility
    
    # Start and end angles (PIL uses degrees, 0 is East, clockwise)
    start_angle = 140
    end_angle = 410 
    steps = 60  # High step count for smooth gradient

    # 3. Draw Gradient Arc
    for i in range(steps):
        t0 = start_angle + (end_angle - start_angle) * (i / steps)
        t1 = start_angle + (end_angle - start_angle) * ((i + 1) / steps)

        # Color Interpolation: Blue (88, 166, 255) to Purple (188, 140, 255)
        frac = i / steps
        r = int(88 + (188 - 88) * frac)
        g = int(166 + (140 - 166) * frac)
        b = 255 

        bbox = [cx - arc_radius, cy - arc_radius, cx + arc_radius, cy + arc_radius]
        draw.arc(bbox, start=t0, end=t1, fill=(r, g, b, 255), width=line_width)

    # 4. Corrected Arrowhead Logic
    # Position of the tip (at the end_angle)
    angle_rad = math.radians(end_angle)
    tip_x = cx + arc_radius * math.cos(angle_rad)
    tip_y = cy + arc_radius * math.sin(angle_rad)

    # Arrowhead size and orientation
    head_size = size * 0.14
    # The "base" of the triangle should be centered on the arc's path
    # We use the tangent (perpendicular to the radius) to orient the head
    tangent = angle_rad + math.pi/2
    
    # Calculate 3 points of the triangle
    p1 = (tip_x, tip_y) # The tip
    p2 = (tip_x - head_size * math.cos(tangent - 0.6), tip_y - head_size * math.sin(tangent - 0.6))
    p3 = (tip_x - head_size * math.cos(tangent + 0.6), tip_y - head_size * math.sin(tangent + 0.6))

    draw.polygon([p1, p2, p3], fill=(188, 140, 255, 255))

    return img

# Create directory if it doesn't exist to prevent crash
if not os.path.exists("icons"):
    os.makedirs("icons")

for sz in [16, 48, 128]:
    try:
        img = make_icon(sz)
        img.save(f"icons/icon{sz}.png")
        print(f"Generated icons/icon{sz}.png")
    except Exception as e:
        print(f"Error for {sz}: {e}")