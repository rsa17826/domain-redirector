from PIL import Image, ImageDraw, ImageFont
import math

def make_icon(size):
    img = Image.new('RGBA', (size, size), (0,0,0,0))
    draw = ImageDraw.Draw(img)
    
    # Background with rounded corners
    pad = size // 10
    r = size // 5
    draw.rounded_rectangle([pad, pad, size-pad, size-pad], radius=r,
                            fill=(22, 27, 34, 255))
    
    # Arrow symbol
    cx, cy = size//2, size//2
    s = size * 0.35
    
    # Draw curved arrow using circles
    # Simple: draw a right-pointing arrow with a curve hint
    # Use gradient-ish look with two circles + arrow
    
    # Draw ↪ style: arc + arrow
    arc_r = int(s * 0.65)
    lw = max(2, size // 10)
    
    # Draw blue to purple gradient arc segments
    steps = 24
    start_angle = 200
    sweep = 240
    
    for i in range(steps):
        t0 = start_angle + sweep * i / steps
        t1 = start_angle + sweep * (i+1) / steps
        
        # Color interpolation blue→purple
        frac = i / steps
        r_c = int(88 + (188-88)*frac)
        g_c = int(166 + (140-166)*frac)
        b_c = int(255 + (255-255)*frac)
        
        x0 = cx - arc_r
        y0 = cy - arc_r
        x1 = cx + arc_r
        y1 = cy + arc_r
        
        draw.arc([x0, y0, x1, y1], start=t0, end=t1, fill=(r_c, g_c, b_c, 255), width=lw)
    
    # Arrowhead at end of arc
    angle_rad = math.radians(start_angle + sweep)
    tip_x = cx + arc_r * math.cos(angle_rad)
    tip_y = cy + arc_r * math.sin(angle_rad)
    
    # Perpendicular arrow head
    head_size = size * 0.15
    perp = angle_rad + math.pi/2
    
    ax = tip_x + head_size * math.cos(angle_rad - 2.4)
    ay = tip_y + head_size * math.sin(angle_rad - 2.4)
    bx = tip_x + head_size * math.cos(angle_rad + 2.4)
    by = tip_y + head_size * math.sin(angle_rad + 2.4)
    
    draw.polygon([(tip_x, tip_y), (ax, ay), (bx, by)], fill=(188, 140, 255, 255))
    
    return img

for sz in [16, 48, 128]:
    try:
        img = make_icon(sz)
        img.save(f'icons/icon{sz}.png')
        print(f'Generated icon{sz}.png')
    except Exception as e:
        print(f'PIL error for {sz}: {e}')
