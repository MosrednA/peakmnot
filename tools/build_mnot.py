# Builds Mnot (a soda can with big glasses and rubber-hose arms and legs), rigs and animates it, and saves
# models/mnot.blend and models/mnot.glb.
#
# Run from the project folder:
#   blender --background --factory-startup --python tools/build_mnot.py -- models
#
# Blender: Z up, the character faces -Y. In the .glb (Y up) it faces +Z, as three.js expects.

import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'models')
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 60                            # clips are timed in 30 fps frames below, sampled at 60


# ---------------------------------------------------------------- small helpers

def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def spow(x, e):
    return math.copysign(abs(x) ** e, x)


def rot(axis, deg):
    return Matrix.Rotation(math.radians(deg), 3, Vector(axis).normalized())


# ---------------------------------------------------------------- materials

MATS = []


def material(name, hexc, rough=0.5, metal=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    if nt is None:
        m.use_nodes = True
        nt = m.node_tree
    b = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if b is None:
        nt.nodes.clear()
        b = nt.nodes.new('ShaderNodeBsdfPrincipled')
        o = nt.nodes.new('ShaderNodeOutputMaterial')
        nt.links.new(b.outputs[0], o.inputs[0])
    col = srgb(hexc) + [1.0]
    b.inputs['Base Color'].default_value = col
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    m.diffuse_color = col[:3] + [alpha]
    m.roughness = rough
    m.metallic = metal
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'BLENDED'
    MATS.append(m)
    return len(MATS) - 1


RED = material('Can', '#e23b2e', rough=0.38, metal=0.15)
SILVER = material('Aluminium', '#d3d8dc', rough=0.3, metal=0.85)
TAB = material('Tab', '#b4bcc2', rough=0.35, metal=0.85)
FRAME = material('Frame', '#1b1b21', rough=0.35)
LENS = material('Lens', '#bfe6f2', rough=0.08, alpha=0.55)
LIMB = material('Limbs', '#2b3440', rough=0.55)
GLOVE = material('Gloves', '#f7f4ee', rough=0.6)
SHOE = material('Shoes', '#2f86a8', rough=0.5)
SOLE = material('Soles', '#f4f1ea', rough=0.6)


# ---------------------------------------------------------------- mesh building blocks

def ring_faces(rings):
    """Quads between consecutive rings (closed loops); a ring of one vertex is a pole."""
    faces = []
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            n = len(b)
            faces += [[a[0], b[(j + 1) % n], b[j]] for j in range(n)]
        elif len(b) == 1:
            n = len(a)
            faces += [[a[j], a[(j + 1) % n], b[0]] for j in range(n)]
        else:
            n = len(a)
            faces += [[a[j], a[(j + 1) % n], b[(j + 1) % n], b[j]] for j in range(n)]
    return faces


def lathe(profile, segs, z0):
    """profile: (radius, z, material of the band above) from the bottom centre round to the top centre."""
    verts, rings = [], []
    for r, z, _ in profile:
        if r < 1e-6:
            rings.append([len(verts)])
            verts.append(Vector((0, 0, z0 + z)))
        else:
            idx = []
            for j in range(segs):
                a = 2 * math.pi * j / segs
                idx.append(len(verts))
                verts.append(Vector((r * math.cos(a), r * math.sin(a), z0 + z)))
            rings.append(idx)
    faces, mats = [], []
    for i in range(len(rings) - 1):
        fs = ring_faces([rings[i], rings[i + 1]])
        faces += fs
        mats += [profile[i][2]] * len(fs)
    return verts, faces, mats


def sphere(segs, rings_n, fn):
    """UV sphere; fn maps a unit-sphere point to its place."""
    verts, rings = [fn(Vector((0, 0, -1)))], [[0]]
    for i in range(1, rings_n):
        phi = -math.pi / 2 + math.pi * i / rings_n
        idx = []
        for j in range(segs):
            a = 2 * math.pi * j / segs
            idx.append(len(verts))
            verts.append(fn(Vector((math.cos(phi) * math.cos(a), math.cos(phi) * math.sin(a), math.sin(phi)))))
        rings.append(idx)
    rings.append([len(verts)])
    verts.append(fn(Vector((0, 0, 1))))
    return verts, ring_faces(rings)


def torus(R, r, segs, csegs, fn):
    """Torus round local Z; fn maps local points to their place."""
    verts, faces = [], []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        for j in range(csegs):
            b = 2 * math.pi * j / csegs
            verts.append(fn(Vector(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a),
                                    r * math.sin(b)))))
    for i in range(segs):
        for j in range(csegs):
            i2, j2 = (i + 1) % segs, (j + 1) % csegs
            faces.append([i * csegs + j, i * csegs + j2, i2 * csegs + j2, i2 * csegs + j])
    return verts, faces


def circle(n):
    return [(math.cos(2 * math.pi * k / n), math.sin(2 * math.pi * k / n)) for k in range(n)]


def squircle(n, p=4.0):
    return [(spow(math.cos(2 * math.pi * k / n), 2 / p), spow(math.sin(2 * math.pi * k / n), 2 / p)) for k in range(n)]


def catmull(pts, n=8):
    P = [Vector(p) for p in pts]
    out = []
    for i in range(len(P) - 1):
        p0 = P[i - 1] if i > 0 else 2 * P[i] - P[i + 1]
        p1, p2 = P[i], P[i + 1]
        p3 = P[i + 2] if i + 2 < len(P) else 2 * P[i + 1] - P[i]
        for k in range(n):
            t = k / n
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t))
    out.append(P[-1])
    return out


def closed_spline(pts, n=10):
    """Centripetal Catmull-Rom through a closed loop of 2D points: smooth, without overshoot at tight corners."""
    m = len(pts)
    out = []
    for i in range(m):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[(i + 1) % m], pts[(i + 2) % m]
        t1 = (p1 - p0).length ** 0.5
        t2 = t1 + (p2 - p1).length ** 0.5
        t3 = t2 + (p3 - p2).length ** 0.5
        for k in range(n):
            t = t1 + (t2 - t1) * k / n
            a1 = p0.lerp(p1, t / t1)
            a2 = p1.lerp(p2, (t - t1) / (t2 - t1))
            a3 = p2.lerp(p3, (t - t2) / (t3 - t2))
            out.append(a1.lerp(a2, t / t2).lerp(a2.lerp(a3, (t - t1) / (t3 - t1)), (t - t1) / (t2 - t1)))
    return out


def sweep(path, section, size, step=0.012, cap='round', cap_n=4, up=(0, 0, 1), closed=False):
    """Sweeps a 2D section along a path. size: (su, sv) or fn(s) -> (su, sv). Returns verts, faces and the
    distance along the path of every vertex (for skin weights)."""
    path = [Vector(p) for p in path]
    if closed:
        path = path + [path[0]]
    cum = [0.0]
    for a, b in zip(path, path[1:]):
        cum.append(cum[-1] + (b - a).length)
    total = cum[-1]
    n = max(2, int(round(total / step)) + 1)
    pts, ss, k = [], [], 0
    for i in range(n):
        s = total * i / (n - 1)
        while k < len(cum) - 2 and cum[k + 1] < s:
            k += 1
        seg = cum[k + 1] - cum[k]
        pts.append(path[k].lerp(path[k + 1], (s - cum[k]) / seg if seg > 0 else 0))
        ss.append(s)
    if closed:
        pts.pop()
        ss.pop()
    m = len(pts)
    if closed:
        T = [(pts[(i + 1) % m] - pts[i - 1]).normalized() for i in range(m)]
    else:
        T = [(pts[min(i + 1, m - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(m)]
    upv = Vector(up)
    n0 = upv - T[0] * upv.dot(T[0])
    if n0.length < 1e-6:
        n0 = Vector((1, 0, 0)) - T[0] * T[0].x
    N = [n0.normalized()]
    for i in range(1, m):
        N.append((N[-1] - T[i] * N[-1].dot(T[i])).normalized())
    B = [T[i].cross(N[i]) for i in range(m)]
    sz = size if callable(size) else (lambda s: size)
    verts, rings, rs = [], [], []

    def ring(c, i, scale):
        su, sv = sz(ss[i])
        idx = []
        for u, v in section:
            idx.append(len(verts))
            verts.append(c + N[i] * (u * su * scale) + B[i] * (v * sv * scale))
        rings.append(idx)
        rs.append(ss[i])

    def pole(c, i):
        rings.append([len(verts)])
        verts.append(c)
        rs.append(ss[i])

    if not closed:
        if cap == 'round':
            cl = min(sz(ss[0]))
            pole(pts[0] - T[0] * cl, 0)
            for k in range(1, cap_n):
                phi = math.pi / 2 * k / cap_n
                ring(pts[0] - T[0] * cl * math.cos(phi), 0, math.sin(phi))
        else:
            pole(pts[0], 0)
    for i in range(m):
        ring(pts[i], i, 1.0)
    if not closed:
        if cap == 'round':
            cl = min(sz(ss[-1]))
            for k in range(cap_n - 1, 0, -1):
                phi = math.pi / 2 * k / cap_n
                ring(pts[-1] + T[-1] * cl * math.cos(phi), m - 1, math.sin(phi))
            pole(pts[-1] + T[-1] * cl, m - 1)
        else:
            pole(pts[-1], m - 1)
    faces = ring_faces(rings)
    if closed:
        faces += ring_faces([rings[-1], rings[0]])
    vs = [0.0] * len(verts)
    for r, s in zip(rings, rs):
        for v in r:
            vs[v] = s
    return verts, faces, vs


def rounded_poly(corners, n_arc=6, n_edge=3):
    """Closed 2D outline through corners ((x, y), fillet radius); returned counter-clockwise."""
    P = [Vector(c[0]) for c in corners]
    m = len(P)
    arcs = []
    for i in range(m):
        p, a, b = P[i], P[i - 1], P[(i + 1) % m]
        u1, u2 = (a - p).normalized(), (b - p).normalized()
        half = math.acos(max(-1.0, min(1.0, u1.dot(u2)))) / 2
        t = min(corners[i][1] / math.tan(half), 0.45 * (a - p).length, 0.45 * (b - p).length)
        r = t * math.tan(half)
        A, Bp = p + u1 * t, p + u2 * t
        C = p + (u1 + u2).normalized() * (r / math.sin(half))
        a0 = math.atan2(A.y - C.y, A.x - C.x)
        d = math.atan2(Bp.y - C.y, Bp.x - C.x) - a0
        d = (d + math.pi) % (2 * math.pi) - math.pi
        arcs.append([C + Vector((math.cos(a0 + d * k / n_arc), math.sin(a0 + d * k / n_arc))) * r
                     for k in range(n_arc + 1)])
    pts = []
    for i in range(m):
        pts += arcs[i]
        end, nxt = arcs[i][-1], arcs[(i + 1) % m][0]
        pts += [end.lerp(nxt, k / (n_edge + 1)) for k in range(1, n_edge + 1)]
    area = sum(pts[i - 1].x * pts[i].y - pts[i].x * pts[i - 1].y for i in range(len(pts)))
    return pts if area > 0 else pts[::-1]


def outward_normals(loop):
    n = len(loop)
    out = []
    for i in range(n):
        t = (loop[(i + 1) % n] - loop[i - 1]).normalized()
        out.append(Vector((t.y, -t.x)))
    return out


# ---------------------------------------------------------------- the model, part by part

class Part:
    def __init__(self):
        self.v, self.f, self.m, self.w = [], [], [], []

    def add(self, verts, faces, mat, weights):
        base = len(self.v)
        self.v += [Vector(p) for p in verts]
        self.f += [[base + i for i in face] for face in faces]
        self.m += mat if isinstance(mat, list) else [mat] * len(faces)
        self.w += weights if isinstance(weights, list) else [weights] * len(verts)

    def extend(self, other):
        self.add(other.v, other.f, other.m, other.w)

    def mirrored(self):
        """The same part on the other side (x -> -x), with _L bones renamed _R."""
        o = Part()
        o.v = [Vector((-p.x, p.y, p.z)) for p in self.v]
        o.f = [face[::-1] for face in self.f]
        o.m = list(self.m)
        o.w = [{k.replace('_L', '_R'): w for k, w in d.items()} for d in self.w]
        return o


model = Part()
BODY = {'body': 1.0}
GL = {'glasses': 1.0}

# The can: 0.6 wide, 1.15 tall, standing on its little legs. The top is a real can end: the rolled seam round the
# rim, the wall down into the countersink groove, and the flat panel with the scored opening and the pull tab.
R, Z0, H = 0.30, 0.50, 1.15
CAN = [
    (0.0, 0.055, SILVER), (0.10, 0.050, SILVER), (0.18, 0.030, SILVER), (0.215, 0.010, SILVER),
    (0.228, 0.000, SILVER), (0.242, 0.004, SILVER), (0.262, 0.025, SILVER), (0.283, 0.055, SILVER),
    (0.296, 0.085, RED), (0.300, 0.115, RED), (0.300, 0.40, RED), (0.300, 0.70, RED), (0.300, 0.98, RED),
    (0.297, 1.015, RED), (0.287, 1.045, RED), (0.272, 1.068, RED), (0.258, 1.084, SILVER),
    (0.249, 1.098, SILVER), (0.246, 1.108, SILVER), (0.249, 1.114, SILVER), (0.256, 1.119, SILVER),  # neck
    (0.259, 1.128, SILVER), (0.259, 1.140, SILVER), (0.256, 1.149, SILVER), (0.250, 1.154, SILVER),  # seam
    (0.243, 1.153, SILVER), (0.238, 1.147, SILVER), (0.236, 1.136, SILVER), (0.232, 1.118, SILVER),  # wall
    (0.228, 1.104, SILVER), (0.224, 1.097, SILVER), (0.219, 1.094, SILVER), (0.214, 1.097, SILVER),  # groove
    (0.212, 1.103, SILVER), (0.209, 1.107, SILVER), (0.195, 1.108, SILVER), (0.0, 1.108, SILVER),   # panel
]
v, f, m = lathe(CAN, 96, Z0)
model.add(v, f, m, BODY)
LID_Z = Z0 + 1.108

# The scored opening in front of the rivet, and the bead pressed round it: two low ridges in the panel. The opening
# is narrow at the rivet and wide along the rim.
SCORE = closed_spline([Vector(p) for p in [
    (0.0, -0.036), (-0.024, -0.046), (-0.050, -0.072), (-0.072, -0.108), (-0.088, -0.140), (-0.070, -0.165),
    (-0.036, -0.178), (0.0, -0.182), (0.036, -0.178), (0.070, -0.165), (0.088, -0.140), (0.072, -0.108),
    (0.050, -0.072), (0.024, -0.046)]], 6)
BEAD = [p + n * 0.014 for p, n in zip(SCORE, outward_normals(SCORE))]
for loop, high, half in ((SCORE, 0.0014, 0.0024), (BEAD, 0.003, 0.0052)):
    # an oval tube, sunk into the panel so it sticks out `high`
    path = [Vector((p.x, p.y, LID_Z - high)) for p in loop]
    v, f, _ = sweep(path, circle(8), (2 * high, half), step=0.006, closed=True)
    model.add(v, f, SILVER, BODY)


def plate(outline, holes, thickness, edge):
    """A flat plate in the xy plane through 2D loops, an outline and its holes, with edges rounded `edge` wide all
    round (a filled Blender curve, turned into a mesh). Returns verts and faces."""
    cu = bpy.data.curves.new('plate', 'CURVE')
    cu.dimensions, cu.fill_mode = '2D', 'BOTH'
    cu.extrude, cu.bevel_depth, cu.bevel_resolution = thickness / 2 - edge, edge, 2
    for loop in [outline] + holes:
        sp = cu.splines.new('POLY')
        sp.points.add(len(loop) - 1)
        for pt, q in zip(sp.points, loop):
            pt.co = (q.x, q.y, 0.0, 1.0)
        sp.use_cyclic_u = True
    ob = bpy.data.objects.new('plate', cu)
    scene.collection.objects.link(ob)
    bpy.context.view_layer.update()
    tmp = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    verts, faces = [v.co.copy() for v in tmp.vertices], [list(p.vertices) for p in tmp.polygons]
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(tmp)
    return verts, faces


# The pull tab, riveted in the middle of the lid: its nose rests on the opening, the finger end lifts a little.
# The rivet sits on a tongue inside a horseshoe slot; behind it is the big finger hole. Edges are rounded (curled).
TAB_T, TAB_EDGE, TAB_LIFT = 0.007, 0.0025, math.radians(3)
tab_outline = rounded_poly([((-0.044, -0.060), 0.04), ((0.044, -0.060), 0.04), ((0.058, 0.138), 0.045),
                            ((-0.058, 0.138), 0.045)], 8, 4)
finger_hole = rounded_poly([((-0.036, 0.050), 0.018), ((0.036, 0.050), 0.018), ((0.046, 0.116), 0.034),
                            ((-0.046, 0.116), 0.034)], 8, 3)
slot_out, slot_in, tongue = 0.029, 0.014, 0.008
a_out, a_in = math.asin(tongue / slot_out), math.asin(tongue / slot_in)
slot = ([Vector((math.cos(a), math.sin(a))) * slot_out
         for a in (-math.pi / 2 + a_out + (2 * math.pi - 2 * a_out) * k / 32 for k in range(33))]
        + [Vector((math.cos(a), math.sin(a))) * slot_in
           for a in (3 * math.pi / 2 - a_in - (2 * math.pi - 2 * a_in) * k / 20 for k in range(21))])
v, f = plate(tab_outline, [finger_hole, slot], TAB_T, TAB_EDGE)
tilt = Matrix.Rotation(TAB_LIFT, 3, 'X')
tab_z = LID_Z + 0.0035 + TAB_T / 2                            # it rests on the rivet, a little above the panel
model.add([tilt @ p + Vector((0, 0, tab_z)) for p in v], f, TAB, BODY)
v, f = sphere(16, 8, lambda p: Vector((0.0095 * p.x, 0.0095 * p.y, tab_z + TAB_T / 2 + 0.0025 * p.z)))
model.add(v, f, TAB, BODY)

# The glasses: big wayfarers traced from the reference drawing, where the can is 101 px wide (0.6 here). Each half is
# a frame plate round one lens with rounded edges; the two halves overlap a little in the middle of the bridge.
GZ, YF, DEPTH, BEND = 1.165, -0.362, 0.045, 0.3
PX = 0.6 / 101


def G(x, z, d):
    """Glasses space (x across, z up, d into the frame) to model space, wrapped a little round the can."""
    return Vector((x, YF + d + BEND * x * x, GZ + z))


def ref(pts):
    """Pixels of the drawing's left lens (can centre at x 136, lens middle at y 121) to Mnot's left lens (+X)."""
    return [Vector(((136 - x) * PX, (121 - y) * PX)) for x, y in pts]


def polar(loop, c):
    """A loop that is star-shaped round c, as a function angle -> point."""
    if sum(p.x * q.y - q.x * p.y for p, q in zip(loop, loop[1:] + loop[:1])) < 0:
        loop = loop[::-1]
    ang = [math.atan2(p.y - c.y, p.x - c.x) % (2 * math.pi) for p in loop]
    k0 = min(range(len(loop)), key=lambda k: ang[k])
    a, r, prev = [], [], None
    for k in range(len(loop)):
        p = loop[(k0 + k) % len(loop)]
        th = ang[(k0 + k) % len(loop)]
        assert prev is None or th > prev, 'glasses outline is not star-shaped round the lens centre'
        a.append(th)
        r.append((p - c).length)
        prev = th
    a.append(a[0] + 2 * math.pi)
    r.append(r[0])

    def at(th):
        th = a[0] + (th - a[0]) % (2 * math.pi)
        lo, hi = 0, len(a) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            lo, hi = (mid, hi) if a[mid] <= th else (lo, mid)
        rr = lerp(r[lo], r[hi], (th - a[lo]) / (a[hi] - a[lo]))
        return c + Vector((math.cos(th), math.sin(th))) * rr
    return at


def matched_loops(inner, outer, c, n):
    """Samples both loops at the same n angles round c, spaced so neither loop gets sparse."""
    fi, fo = polar(inner, c), polar(outer, c)
    K = 2000
    A = [2 * math.pi * k / K for k in range(K + 1)]
    pi_, po = [fi(th) for th in A], [fo(th) for th in A]
    ci, co = [0.0], [0.0]
    for k in range(K):
        ci.append(ci[-1] + (pi_[k + 1] - pi_[k]).length)
        co.append(co[-1] + (po[k + 1] - po[k]).length)
    w = [ci[k] / ci[-1] + co[k] / co[-1] for k in range(K + 1)]
    out_i, out_o, k = [], [], 0
    for j in range(n):
        target = 2.0 * j / n
        while w[k + 1] < target:
            k += 1
        th = lerp(A[k], A[k + 1], (target - w[k]) / (w[k + 1] - w[k]))
        out_i.append(fi(th))
        out_o.append(fo(th))
    return out_i, out_o


LENS_HOLE = ref([(122.9, 121.0), (125.1, 111.6), (122.8, 102.1), (114.7, 96.3), (105.8, 93.7), (97.7, 92.3),
                 (90.0, 92.0), (82.3, 92.3), (74.0, 93.3), (64.4, 95.4), (56.2, 101.5), (54.9, 111.6), (55.9, 121.0),
                 (58.4, 129.5), (61.5, 137.4), (67.2, 143.8), (74.8, 147.4), (82.5, 148.9), (90.0, 149.0),
                 (97.3, 148.1), (104.1, 145.5), (110.3, 141.3), (115.4, 135.7), (119.5, 128.9)])
# the outside of the frame: brow, the hinge wing, the thin rim round the bottom, and the bridge, which runs on past
# the middle (x 136) so the half can be cut off there and welded to its mirror image
FRAME_EDGE = ref([(140.0, 95.25), (136.0, 95.2), (132.0, 95.2), (126.0, 94.8), (118.0, 93.1), (107.5, 90.7), (98.5, 89.4),
                  (90.0, 88.25), (81.0, 87.7), (71.0, 88.2), (59.2, 90.2), (52.0, 91.6), (46.0, 93.0), (42.2, 93.9),
                  (41.2, 95.5), (40.9, 99.5), (41.3, 103.2), (42.3, 105.2), (44.0, 107.6), (46.0, 109.9),
                  (48.0, 113.1), (49.2, 116.5), (50.0, 120.8), (52.0, 126.9), (54.0, 132.5), (56.0, 137.5),
                  (58.0, 141.5), (63.9, 147.1), (72.6, 151.2), (81.5, 152.9), (90.0, 152.9), (98.4, 152.2),
                  (106.6, 149.7), (113.7, 144.7), (119.3, 137.9), (122.0, 132.9), (124.0, 129.0), (126.0, 124.6),
                  (128.0, 117.4), (130.0, 112.4), (132.0, 110.4), (134.0, 109.85), (136.0, 109.8), (138.0, 109.8),
                  (140.5, 109.0), (141.8, 106.0), (142.0, 100.0), (141.5, 96.5)])
LENS_C = ref([(90.0, 100.0)])[0]              # every ray from here crosses the lens edge and the frame edge once
hole, edge = matched_loops(closed_spline(LENS_HOLE), closed_spline(FRAME_EDGE), LENS_C, 120)
if sum(p.x * q.y - q.x * p.y for p, q in zip(hole, hole[1:] + hole[:1])) < 0:
    hole, edge = hole[::-1], edge[::-1]
n_hole, n_edge = outward_normals(hole), outward_normals(edge)
N = len(hole)
RC = 0.008                                    # radius of the rounded edges

# the frame's cross-section, all the way round: (outer edge or lens edge, inset into the frame, depth)
arc = [math.pi / 2 * k / 3 for k in range(4)]
profile = ([('edge', RC * (1 - math.sin(a)), RC * (1 - math.cos(a))) for a in arc]
           + [('edge', RC * (1 - math.cos(a)), DEPTH - RC + RC * math.sin(a)) for a in arc]
           + [('hole', RC * (1 - math.sin(a)), DEPTH - RC + RC * math.cos(a)) for a in arc]
           + [('hole', RC * (1 - math.cos(a)), RC * (1 - math.sin(a))) for a in arc])
bm = bmesh.new()
for which, inset, d in profile:
    for i in range(N):
        q = edge[i] - n_edge[i] * inset if which == 'edge' else hole[i] + n_hole[i] * inset
        bm.verts.new(G(q.x, q.y, d))
bm.verts.ensure_lookup_table()
rings = [list(range(k * N, (k + 1) * N)) for k in range(len(profile))]
for face in ring_faces(rings) + ring_faces([rings[-1], rings[0]]):
    bm.faces.new([bm.verts[i] for i in face])
thin = min((edge[i] - hole[i]).length for i in range(N))
print(f'thinnest frame rim {thin:.4f}')
assert thin > 2 * RC
# cut the half off in the middle of the bridge and weld it to its mirror image: one seamless frame
bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-7, plane_co=(0, 0, 0),
                       plane_no=(1, 0, 0), clear_inner=True)
for bv in bm.verts:
    if abs(bv.co.x) < 1e-6:
        bv.co.x = 0.0
bmesh.ops.mirror(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], matrix=Matrix.Identity(4), merge_dist=1e-6,
                 axis='X')
bm.verts.index_update()
model.add([bv.co.copy() for bv in bm.verts], [[bv.index for bv in fc.verts] for fc in bm.faces], FRAME, GL)
bm.free()

glasses = Part()

# the lens: a thin pane tucked into the middle of the frame
pane = [hole[i] + n_hole[i] * 0.006 for i in range(N)]
verts = [G(p.x, p.y, DEPTH * 0.5 - 0.0045) for p in pane] + [G(p.x, p.y, DEPTH * 0.5 + 0.0045) for p in pane]
verts += [G(LENS_C.x, LENS_C.y, DEPTH * 0.5 - 0.0045), G(LENS_C.x, LENS_C.y, DEPTH * 0.5 + 0.0045)]
fc, bc = 2 * N, 2 * N + 1
faces = []
for i in range(N):
    i2 = (i + 1) % N
    faces += [[fc, i2, i], [bc, N + i, N + i2], [i, i2, N + i2, N + i]]
glasses.add(verts, faces, LENS, GL)

# the temple: from the back of the hinge wing round to the side of the can, a flat bar
WING = ref([(43.0, 99.0)])[0]
v, f, _ = sweep(catmull([G(WING.x, WING.y, DEPTH * 0.55), Vector((0.55, -0.15, GZ + WING.y - 0.004)),
                         Vector((0.44, -0.02, GZ + WING.y - 0.01)), Vector((0.255, 0.115, GZ + WING.y - 0.016))], 8),
                squircle(12, 3.5), (0.013, 0.0075), step=0.012)
glasses.add(v, f, FRAME, GL)
model.extend(glasses)
model.extend(glasses.mirrored())

# ---------------------------------------------------------------- limbs (built on the left, +X, then mirrored)

ARM_A = math.radians(60)                      # arms hang 60 degrees below horizontal in the rest pose
D_ARM = Vector((math.cos(ARM_A), 0, -math.sin(ARM_A)))
SHOULDER = Vector((0.30, 0, 0.86))           # the shoulder pivot sits on the can's skin, so the arm stays put there
UPPER, FORE = 0.235, 0.235
ELBOW = SHOULDER + D_ARM * UPPER
WRIST = ELBOW + D_ARM * FORE
ARM_R = 0.035

HIP = Vector((0.13, 0, 0.56))
KNEE = Vector((0.13, -0.015, 0.32))
ANKLE = Vector((0.13, 0, 0.08))
THIGH, SHIN = (KNEE - HIP).length, (ANKLE - KNEE).length
LEG_R = 0.04

left = Part()

# arm: one rubber-hose tube from the shoulder to the wrist; its rounded end turns on the shoulder pivot, sunk into
# the can, so swinging the arm never slides it over the can
v, f, vs = sweep([SHOULDER, WRIST], circle(12), (ARM_R, ARM_R), step=0.015, up=(0, -1, 0))
w = []
for s in vs:
    fore = smooth(UPPER - 0.07, UPPER + 0.07, s)
    hand = smooth(UPPER + FORE - 0.035, UPPER + FORE + 0.005, s)
    w.append({'upper_arm_L': 1 - fore, 'forearm_L': fore - hand, 'hand_L': hand})
left.add(v, f, LIMB, w)

# glove: puffy cuff, palm, three fingers and a thumb
U = D_ARM
F = Vector((0, -1, 0))                       # thumb side faces forward
Nn = U.cross(F).normalized()                 # palm faces the body
HAND = {'hand_L': 1.0}
GS = 1.35                                    # big cartoon gloves


def hp(u, f_, n):
    return WRIST + (U * u + F * f_ + Nn * n) * GS


v, f = torus(0.046, 0.019, 16, 8, lambda p: hp(0.004 + p.z, p.x, p.y))
left.add(v, f, GLOVE, HAND)
v, f = sphere(16, 10, lambda p: hp(0.068 + 0.05 * p.z, 0.056 * p.x, 0.032 * p.y))
left.add(v, f, GLOVE, HAND)
for fo, ln in ((-0.03, 0.062), (0.0, 0.072), (0.03, 0.066)):
    path = catmull([hp(0.085, fo, 0.0), hp(0.085 + ln * 0.6, fo * 1.15, 0.008), hp(0.085 + ln, fo * 1.25, 0.024)], 4)
    v, f, _ = sweep(path, circle(10), (0.019 * GS, 0.019 * GS), step=0.012)
    left.add(v, f, GLOVE, HAND)
path = catmull([hp(0.045, 0.035, 0.004), hp(0.07, 0.072, 0.018), hp(0.092, 0.084, 0.03)], 4)
v, f, _ = sweep(path, circle(10), (0.02 * GS, 0.02 * GS), step=0.012)
left.add(v, f, GLOVE, HAND)

# leg: one tube from inside the can, through the knee, into the shoe
inside = 0.04
v, f, vs = sweep([HIP + Vector((0, 0, inside)), HIP, KNEE, ANKLE], circle(12), (LEG_R, LEG_R), step=0.015,
                 up=(0, -1, 0))
w = []
for s in vs:
    s -= inside
    shin = smooth(THIGH - 0.07, THIGH + 0.07, s)
    foot = smooth(THIGH + SHIN - 0.03, THIGH + SHIN + 0.01, s)
    w.append({'thigh_L': 1 - shin, 'shin_L': shin - foot, 'foot_L': foot})
left.add(v, f, LIMB, w)

# sneaker: rounded upper with a lowered toe, white toe cap, white sole, collar round the ankle
FOOT = {'foot_L': 1.0}
X0 = ANKLE.x


def sh(x, y, z):
    """Shoe space to model space: big cartoon sneakers."""
    return Vector((X0 + 1.25 * x, 1.25 * y, 1.12 * z))


def upper(p):
    x, y, z = 0.07 * p.x, -0.035 + 0.118 * p.y, 0.062 + 0.06 * p.z
    front = smooth(0, 1, (-y - 0.035) / 0.118)
    if z > 0.028:
        z = 0.028 + (z - 0.028) * (1 - 0.33 * front * front)
    return sh(x, y, max(z, 0.02))


v, f = sphere(24, 12, upper)
left.add(v, f, SHOE, FOOT)
v, f = sphere(18, 10, lambda p: sh(0.06 * p.x, -0.112 + 0.05 * p.y, 0.042 + 0.033 * p.z))
left.add(v, f, SOLE, FOOT)
v, f = torus(0.044, 0.016, 16, 8, lambda p: sh(p.x, 0.004 + p.y, 0.112 + p.z))
left.add(v, f, SHOE, FOOT)
outline = [(0.078 * spow(math.cos(a), 2 / 2.8), -0.035 + 0.128 * spow(math.sin(a), 2 / 2.8))
           for a in (2 * math.pi * k / 32 for k in range(32))]
verts, rings = [sh(0, -0.035, 0.0)], [[0]]
for sc, z in ((0.90, 0.0), (0.98, 0.004), (1.0, 0.012), (1.0, 0.024), (0.97, 0.031)):
    rings.append(list(range(len(verts), len(verts) + 32)))
    verts += [sh(x * sc, -0.035 + (y + 0.035) * sc, z) for x, y in outline]
rings.append([len(verts)])
verts.append(sh(0, -0.035, 0.031))
left.add(verts, ring_faces(rings), SOLE, FOOT)

model.extend(left)
model.extend(left.mirrored())

# ---------------------------------------------------------------- one mesh

me = bpy.data.meshes.new('Mnot')
me.from_pydata([tuple(p) for p in model.v], [], model.f)
for m in MATS:
    me.materials.append(m)
me.polygons.foreach_set('material_index', model.m)
me.validate()
bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(me)
bm.free()
me.shade_smooth()
me.set_sharp_from_angle(angle=math.radians(55))
mesh_obj = bpy.data.objects.new('Mnot', me)
scene.collection.objects.link(mesh_obj)

# ---------------------------------------------------------------- the rig

arm_data = bpy.data.armatures.new('MnotRig')
arm = bpy.data.objects.new('MnotRig', arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
FWD, UP = Vector((0, -1, 0)), Vector((0, 0, 1))


def bone(name, head, tail, parent=None, roll_to=FWD, connect=False, deform=True):
    b = eb.new(name)
    b.head, b.tail = Vector(head), Vector(tail)
    b.align_roll(roll_to)
    if parent:
        b.parent = eb[parent]
        b.use_connect = connect
    b.use_deform = deform
    return b


bone('root', (0, 0, 0), (0, 0.3, 0), roll_to=UP)
bone('body', (0, 0, 0.62), (0, 0, 1.62), 'root')
bone('glasses', (0, -0.30, GZ), (0, -0.42, GZ), 'body', roll_to=UP)
for side, sx in (('L', 1), ('R', -1)):
    mx = Vector((sx, 1, 1))

    def mir(p):
        return Vector(p) * mx

    bone(f'upper_arm_{side}', mir(SHOULDER), mir(ELBOW), 'body')
    bone(f'forearm_{side}', mir(ELBOW), mir(WRIST), f'upper_arm_{side}', connect=True)
    bone(f'hand_{side}', mir(WRIST), mir(WRIST + D_ARM * 0.15), f'forearm_{side}', connect=True)
    bone(f'thigh_{side}', mir(HIP), mir(KNEE), 'body')
    bone(f'shin_{side}', mir(KNEE), mir(ANKLE), f'thigh_{side}', connect=True)
    bone(f'foot_{side}', mir(ANKLE), mir(ANKLE + Vector((0, -0.17, 0))), f'shin_{side}', connect=True, roll_to=UP)
    # animation controls (not exported): a foot IK handle and a knee pole that follows it
    bone(f'foot_ik_{side}', mir(ANKLE), mir(ANKLE + Vector((0, -0.17, 0))), 'root', roll_to=UP, deform=False)
    bone(f'knee_pole_{side}', mir(Vector((0.13, -0.5, 0.32))), mir(Vector((0.13, -0.5, 0.40))), f'foot_ik_{side}',
         roll_to=FWD, deform=False)
bpy.ops.object.mode_set(mode='OBJECT')

deform_col = arm_data.collections.new('Deform')
ctrl_col = arm_data.collections.new('Controls')
for b in arm_data.bones:
    (deform_col if b.use_deform else ctrl_col).assign(b)
    if not b.use_deform:
        b.color.palette = 'THEME09'
arm_data.display_type = 'OCTAHEDRAL'
arm.show_in_front = True

for side in 'LR':
    ik = arm.pose.bones[f'shin_{side}'].constraints.new('IK')
    ik.target, ik.subtarget = arm, f'foot_ik_{side}'
    ik.pole_target, ik.pole_subtarget = arm, f'knee_pole_{side}'
    ik.chain_count = 2
    cr = arm.pose.bones[f'foot_{side}'].constraints.new('COPY_ROTATION')
    cr.target, cr.subtarget = arm, f'foot_ik_{side}'

# find the pole angle that keeps the rest pose exactly as built
best = None
for deg in range(-180, 180, 5):
    for side in 'LR':
        arm.pose.bones[f'shin_{side}'].constraints[0].pole_angle = math.radians(deg)
    bpy.context.view_layer.update()
    err = 0.0
    for name in ('thigh_L', 'shin_L', 'thigh_R', 'shin_R'):
        pb = arm.pose.bones[name]
        err += (pb.matrix.to_3x3() @ pb.bone.matrix_local.to_3x3().inverted()).to_quaternion().angle
    if best is None or err < best[1]:
        best = (deg, err)
for side in 'LR':
    arm.pose.bones[f'shin_{side}'].constraints[0].pole_angle = math.radians(best[0])
print(f'pole angle {best[0]} deg, rest error {math.degrees(best[1]):.3f} deg')

# skin
mesh_obj.parent = arm
mod = mesh_obj.modifiers.new('Armature', 'ARMATURE')
mod.object = arm
groups = {}
for i, d in enumerate(model.w):
    for name, wt in d.items():
        if wt <= 1e-4:
            continue
        if name not in groups:
            groups[name] = mesh_obj.vertex_groups.new(name=name)
        groups[name].add([i], wt, 'REPLACE')

# ---------------------------------------------------------------- animation

ANIM = ['body', 'glasses', 'upper_arm_L', 'forearm_L', 'hand_L', 'upper_arm_R', 'forearm_R', 'hand_R',
        'foot_ik_L', 'foot_ik_R']
I3 = Matrix.Identity(3)
X, Y, Z = (1, 0, 0), (0, 1, 0), (0, 0, 1)
D_R = Vector((-D_ARM.x, 0, D_ARM.z))
HINGE = {'L': D_ARM.cross(FWD).normalized(), 'R': D_R.cross(FWD).normalized()}   # elbow bends the hand forward
ARMDIR = {'L': D_ARM, 'R': D_R}
SIGN = {'L': 1, 'R': -1}


def pose_to_local(pb, loc, R):
    M = pb.bone.matrix_local.to_3x3()
    Mi = M.inverted()
    return Mi @ Vector(loc), (Mi @ R @ M).to_quaternion()


def foot_cycle(p, L, S, lift, toe_off, heel):
    """Foot of an in-place gait at phase p (0 = heel strike): (y, z, pitch); pitch > 0 is toes down."""
    if p < S:
        q = p / S
        y = -L / 2 + L * q
        z = 0.0
        pitch = -heel * (1 - smooth(0, 0.25, q)) + toe_off * smooth(0.65, 1.0, q)
    else:
        q = (p - S) / (1 - S)
        y = L / 2 - L * smooth(0, 1, q)
        z = lift * math.sin(math.pi * q) ** 1.3
        pitch = lerp(toe_off, -heel, smooth(0.1, 0.95, q))
    # rolling over the toe or heel lifts the ankle so the shoe stays on the ground
    z += 0.16 * math.sin(math.radians(pitch)) if pitch > 0 else 0.1 * math.sin(math.radians(-pitch))
    return y, z, pitch


def arms(P, swing, lower, elbow, hand_lag=0.0):
    for side in 'LR':
        sg = SIGN[side]
        P[f'upper_arm_{side}'] = ((0, 0, 0), rot(X, sg * swing) @ rot(Y, sg * lower))
        P[f'forearm_{side}'] = ((0, 0, 0), rot(HINGE[side], elbow[side]))
        P[f'hand_{side}'] = ((0, 0, 0), rot(HINGE[side], hand_lag * sg))


def gait(t, L, S, lift, toe_off, heel, dz0, bob, bob_phase, lean, roll, yaw, sway, swing, elbow, elbow_var,
         lower, glasses_bounce):
    P = {}
    for side, ph in (('L', 0.0), ('R', 0.5)):
        y, z, pitch = foot_cycle((t + ph) % 1.0, L, S, lift, toe_off, heel)
        P[f'foot_ik_{side}'] = ((0, y, z), rot(X, pitch))
    w = 2 * math.pi * t
    dz = dz0 - bob * math.cos(2 * w - bob_phase)
    P['body'] = ((sway * math.sin(w), 0, dz), rot(Z, -yaw * math.cos(w)) @ rot(Y, roll * math.sin(w)) @ rot(X, lean))
    c = math.cos(w)
    arms(P, swing * c, lower, {'L': elbow - elbow_var * c, 'R': elbow + elbow_var * c}, hand_lag=6 * math.sin(w))
    P['glasses'] = ((0, 0, -glasses_bounce * math.cos(2 * w - bob_phase - 1.0)), rot(Y, -1.5 * math.sin(w - 0.6)))
    return P


def walk(t):
    return gait(t, L=0.28, S=0.56, lift=0.075, toe_off=20, heel=12, dz0=-0.023, bob=0.013, bob_phase=0.0,
                lean=4, roll=5, yaw=5, sway=0.012, swing=22, elbow=22, elbow_var=10, lower=12, glasses_bounce=0.007)


def run(t):
    return gait(t, L=0.40, S=0.36, lift=0.13, toe_off=30, heel=8, dz0=-0.056, bob=0.012, bob_phase=2.26,
                lean=10, roll=3, yaw=8, sway=0.006, swing=38, elbow=75, elbow_var=12, lower=20, glasses_bounce=0.014)


def idle(t):
    w = 2 * math.pi * t
    P = {'foot_ik_L': ((0, 0, 0), I3), 'foot_ik_R': ((0, 0, 0), I3)}
    P['body'] = ((0, 0, -0.03 + 0.006 * math.sin(w)), rot(Y, 1.5 * math.sin(w)) @ rot(X, 1.0 * math.sin(w + 1)))
    arms(P, 3 * math.sin(w + 1.0), 8, {'L': 14 + 3 * math.sin(w), 'R': 14 + 3 * math.sin(w + 0.4)})
    P['glasses'] = ((0, 0, 0.004 * math.sin(w - 0.7)), I3)
    return P


def aim(a, b):
    return Vector(a).rotation_difference(Vector(b)).to_matrix()


def basis(x, n):
    x = Vector(x).normalized()
    n = (Vector(n) - x * x.dot(Vector(n))).normalized()
    return Matrix((x, n, x.cross(n))).transposed()


PALM_R = Vector((-Nn.x, Nn.y, Nn.z))


def wave(t):
    w = 2 * math.pi * t
    P = {'foot_ik_L': ((0, 0, 0), I3), 'foot_ik_R': ((0, 0, 0), I3)}
    P['body'] = ((0.01, 0, -0.03 + 0.005 * math.sin(2 * w)), rot(Y, 3 + 1.2 * math.sin(w)) @ rot(Z, 6))
    arms(P, 0, 8, {'L': 15, 'R': 0})
    s = math.sin(3 * w)
    upper_dir = Vector((-0.97, -0.12, 0.2 + 0.03 * math.sin(w)))     # out to the side, so the hand clears the glasses
    fore_dir = Vector((-0.5 - 0.2 * s, -0.12, 0.9))
    Ru = aim(D_R, upper_dir)
    Rf = aim(D_R, Ru.inverted() @ fore_dir.normalized())
    # the palm faces forward and the hand flaps a little behind the forearm
    hand = rot(Vector((0, -1, 0)), 16 * math.sin(3 * w - 0.9)) @ basis(fore_dir, (0, -1, 0))
    hand = hand @ basis(D_R, PALM_R).inverted()
    P['upper_arm_R'] = ((0, 0, 0), Ru)
    P['forearm_R'] = ((0, 0, 0), Rf)
    P['hand_R'] = ((0, 0, 0), (Ru @ Rf).inverted() @ hand)
    P['glasses'] = ((0, 0, 0.003 * math.sin(2 * w - 0.7)), rot(Y, 2 * math.sin(w - 0.5)))
    return P


def hermite(p0, p1, m0, m1, t):
    """Cubic from p0 to p1; m0 and m1 are the slopes times the length of the stretch."""
    t2, t3 = t * t, t * t * t
    return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1


def curve(keys, f):
    """Smooth curve through (frame, value) keys that never overshoots them (monotone cubic), flat at both ends."""
    xs, ys = [k[0] for k in keys], [k[1] for k in keys]
    if f <= xs[0]:
        return ys[0]
    if f >= xs[-1]:
        return ys[-1]
    d = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(len(keys) - 1)]
    m = [0.0] + [0.0 if d[i - 1] * d[i] <= 0 else 2 / (1 / d[i - 1] + 1 / d[i]) for i in range(1, len(d))] + [0.0]
    i = max(j for j in range(len(d)) if xs[j] <= f)
    h = xs[i + 1] - xs[i]
    return hermite(ys[i], ys[i + 1], m[i] * h, m[i + 1] * h, (f - xs[i]) / h)


def ground_foot(pitch):
    """Ankle lift that keeps the toe (pitch > 0) or the heel (pitch < 0) on the ground."""
    return 0.16 * math.sin(math.radians(pitch)) if pitch > 0 else 0.1 * math.sin(math.radians(-pitch))


def pose_arms(P, swing, lower, elbow, hand):
    """Arms by side: swing > 0 swings the arm back, lower > 0 brings it down to the can, elbow > 0 bends it."""
    for side in 'LR':
        P[f'upper_arm_{side}'] = ((0, 0, 0), rot(X, swing[side]) @ rot(Y, SIGN[side] * lower[side]))
        P[f'forearm_{side}'] = ((0, 0, 0), rot(HINGE[side], elbow[side]))
        P[f'hand_{side}'] = ((0, 0, 0), rot(HINGE[side], hand[side]))


def both(x):
    return {'L': x, 'R': x}


# The jump comes in three parts, so the game decides how long Mnot stays in the air: a take-off (JumpStart standing,
# LeapStart on the move), the Fall loop for the air, and a landing (Land, LeapLand on the move, LandHard after a long
# fall). The clips stay in place: the game lifts the root with gravity from the take-off time stored on the rig.
GRAVITY = 15.0                                   # units per second squared
JUMP_HEIGHT, RUN_JUMP_HEIGHT = 0.6, 0.8          # standing or walking, running
HARD_LANDING = 6.0                               # touch-down speed (units per second) from which LandHard plays
JUMP_TAKEOFF, LEAP_TAKEOFF = 3.6, 3.6            # frames: the feet leave the ground after 0.12 seconds
V_UP = math.sqrt(2 * GRAVITY * JUMP_HEIGHT) / 30     # take-off speed per frame, to join the push onto the flight


def blend(A, B, w):
    """Pose A blended towards pose B by w: locations lerp, rotations slerp."""
    P = {}
    for name in A.keys() | B.keys():
        (la, Ra), (lb, Rb) = A.get(name, ((0, 0, 0), I3)), B.get(name, ((0, 0, 0), I3))
        qa, qb = Ra.to_quaternion(), Rb.to_quaternion()
        if qa.dot(qb) < 0:
            qb.negate()
        P[name] = (Vector(la).lerp(Vector(lb), w), qa.slerp(qb, w).to_matrix())
    return P


def fall(t):
    """In the air, going up or down: arms up and paddling for balance, legs reaching down and pedalling slowly.
    The toes hang at the root's height, so they touch the ground when the game puts the root down."""
    w = 2 * math.pi * t
    P = {}
    for side, ph in (('R', 0.0), ('L', math.pi)):
        a = w + ph
        pitch = 24 + 6 * math.sin(a + 0.6)
        z = ground_foot(pitch) + 0.01 + 0.025 * (1 + math.sin(a))
        P[f'foot_ik_{side}'] = ((0, -0.01 - 0.06 * math.cos(a), z), rot(X, pitch))
    P['body'] = ((0, 0, 0.03 + 0.008 * math.sin(2 * w)), rot(Y, 3 * math.sin(w)) @ rot(X, -3 + 2 * math.sin(2 * w)))
    flap = lambda d: math.sin(2 * w + d)
    pose_arms(P, {'L': -8 + 6 * math.sin(w), 'R': -8 - 6 * math.sin(w)},
              {'L': -70 + 12 * flap(0.0), 'R': -70 + 12 * flap(0.7)},
              {'L': 35 + 8 * flap(0.9), 'R': 35 + 8 * flap(1.6)},
              {'L': 12 * flap(-0.6), 'R': 12 * flap(0.1)})
    P['glasses'] = ((0, 0, 0.012 + 0.004 * math.sin(2 * w - 1.0)), rot(X, 2 + 1.5 * math.sin(w - 0.5)))
    return P


def jump_start(t):
    """Standing take-off: a quick crouch, push up onto the toes and leave the ground at JUMP_TAKEOFF. Then the feet
    tuck up and the arms swing high, ending in the Fall pose."""
    f, up = t * 10, JUMP_TAKEOFF
    if f < 2:
        dz = hermite(-0.03, -0.13, 0, 0, f / 2)
    elif f < up:
        dz = hermite(-0.13, 0.06, 0, V_UP * (up - 2), (f - 2) / (up - 2))
    else:
        dz = 0.06
    if f < up:                                   # heels down in the crouch, then roll up onto the toes
        pitch = 32 * smooth(1.6, up, f)
        z = ground_foot(pitch)
    else:                                        # off the ground: the feet tuck up under the can
        q = math.sin(math.pi / 2 * min(1.0, (f - up) / 3))
        pitch, z = 32 - 6 * q, ground_foot(32) + 0.09 * q
    P = {'foot_ik_L': ((0, 0, z), rot(X, pitch)), 'foot_ik_R': ((0, 0, z), rot(X, pitch))}
    k = lambda keys: curve(keys, f)
    P['body'] = ((0, 0, dz), rot(X, k([(0, 0.8), (2, 12), (up, -3), (6, -1)])))
    pose_arms(P, both(k([(0, 2.5), (1.6, 34), (up + 1.2, -28), (7, -20)])),
              both(k([(0, 8), (1.6, 15), (up + 1.2, -40), (7.5, -82)])),
              both(k([(0, 14), (1.6, 26), (up + 0.6, 32), (7, 25)])),
              both(k([(0, 0), (1.6, -15), (up + 1.2, 16), (7, 4)])))
    # the glasses lag behind: they float up in the crouch and sink at the push
    gz = k([(0, 0), (2, 0.006), (up + 0.6, -0.02), (7, 0.012)])
    P['glasses'] = ((0, 0, gz), rot(X, k([(0, 0), (2, 2), (up + 0.5, -4), (7, 2)])))
    return blend(P, fall(0), smooth(6, 10, f))


def leap_start(t):
    """Take-off on the move: push off from the left foot while the right knee drives forward, and leave the ground at
    LEAP_TAKEOFF. In the air the legs stay split and the arms fly up, highest at the top of the jump, then come down
    into the landing's swing while the right foot reaches down for LeapLand. It lasts a whole running jump; only a
    longer flight carries on into the Fall loop."""
    f, up = t * 24, LEAP_TAKEOFF
    k = lambda keys: curve(keys, f)
    # the take-off leg dips the body, then drives it up at the speed the flight starts with
    if f < 1.8:
        dz = hermite(-0.04, -0.16, -0.04, 0, f / 1.8)
    elif f < up:
        dz = hermite(-0.16, 0.0, 0, V_UP * (up - 1.8), (f - 1.8) / (up - 1.8))
    else:
        dz = k([(up, 0.0), (10, 0.02), (20, 0.03)])
    # the left foot pushes off and trails behind; the right knee drives forward and the foot reaches for the ground
    ly = k([(0, 0.0), (up, 0.18), (7, 0.24), (14, 0.2), (21, 0.08), (24, 0.06)])
    lp = k([(0, 0), (up, 35), (7, 42), (14, 40), (21, 28), (24, 26)])
    lz = ground_foot(lp) if f < up else k([(up, ground_foot(35)), (8, 0.19), (13, 0.2), (21, 0.12), (24, 0.1)])
    ry = k([(0, 0.0), (up, -0.18), (7, -0.22), (14, -0.2), (21, -0.12), (24, -0.10)])
    rp = k([(0, 12), (up, 5), (7, 0), (14, 5), (21, 13), (24, 15)])
    rz = k([(0, 0.16), (up, 0.12), (7, 0.11), (14, 0.085), (21, 0.05), (24, ground_foot(15) + 0.004)])
    P = {'foot_ik_L': ((0, ly, lz), rot(X, lp)), 'foot_ik_R': ((0, ry, rz), rot(X, rp))}
    P['body'] = ((0, 0, dz), rot(Z, k([(0, -3.4), (up, 6), (8, 7), (16, 3), (24, 0)]))
                 @ rot(X, k([(0, 10), (up, 14), (8, 9), (16, 5), (24, 3)])))
    # The arms open out at the top and flap as in Fall, then settle before touchdown (frame 20 walking, 22 running)
    # into the landing's swing. The last keys lie past the clip's end, so they are still moving there.
    env = smooth(up, up + 3, f) * (1 - smooth(15, 19.5, f))
    flap = {'L': env * math.sin(2 * math.pi * (f - up) / 11), 'R': env * math.sin(2 * math.pi * (f - up) / 11 + 0.7)}
    pose_arms(P, {'L': k([(0, 16), (up, -36), (7, -42), (13, -16), (19, -31), (28, -26)]),
                  'R': k([(0, -16), (up, 32), (8, 40), (13, 14), (19, 26), (28, 20)])},
              {'L': k([(0, 20), (up, -10), (11, -70), (28, -22)]) + 10 * flap['L'],
               'R': k([(0, 20), (up, -5), (12, -66), (28, -22)]) + 10 * flap['R']},
              {'L': k([(0, 70), (up, 58), (11, 32), (28, 46)]) + 8 * flap['L'],
               'R': k([(0, 80), (up, 66), (12, 36), (28, 52)]) + 8 * flap['R']},
              {side: k([(0, 0), (up, 8), (8, 0), (28, 2)]) + 12 * flap[side] for side in 'LR'})
    gz = k([(0, 0), (2.6, -0.022), (6, 0.014), (10, 0.016), (18, 0.01), (24, 0.012)])
    P['glasses'] = ((0, 0, gz), rot(X, k([(0, 0), (up, -3), (9, 1), (24, 2)])))
    return P


def land(t):
    """Soft landing out of the Fall loop: toes first, roll onto the heels, absorb it in the knees and stand up into
    Idle."""
    f = t * 10
    dz = hermite(0.03, -0.14, -V_UP * 3, 0, f / 3) if f < 3 else hermite(-0.14, -0.03, 0, 0, (f - 3) / 7)
    pitch = 24 * (1 - smooth(0, 1.5, f))
    z = ground_foot(pitch)
    P = {'foot_ik_L': ((0, 0, z), rot(X, pitch)), 'foot_ik_R': ((0, 0, z), rot(X, pitch))}
    k = lambda keys: curve(keys, f)
    P['body'] = ((0, 0, dz), rot(X, k([(0, -3), (3, 9), (6, 2), (10, 0.8)])))
    pose_arms(P, both(k([(0, -8), (3.5, -18), (6.5, 6), (10, 2.5)])),
              both(k([(0, -70), (3.5, -8), (5.5, 13), (10, 8)])),
              both(k([(0, 35), (3, 40), (6, 18), (10, 14)])),
              both(k([(0, 0), (3, -12), (6, 6), (10, 0)])))
    gz = k([(0, 0.012), (2.5, -0.025), (5, 0.008), (7.5, -0.003), (10, 0)])
    P['glasses'] = ((0, 0, gz), rot(X, k([(0, 2), (3, 6), (6, -2), (10, 0)])))
    return blend(P, idle(0), smooth(6, 10, f))


GAIT0 = blend(walk(0), run(0), 0.5)              # the left heel strike, halfway between Walk and Run


def leap_land(t):
    """Landing on the move, out of LeapStart: down on the right toes, the left leg swings through to its heel strike,
    where Walk and Run begin, so either carries on from time 0. The arms swing on as in a stride."""
    f = t * 7
    dz = hermite(0.03, -0.13, -V_UP * 2.5, 0, f / 2.5) if f < 2.5 else hermite(-0.13, -0.04, 0, 0, (f - 2.5) / 4.5)
    if f < 5:                                    # the right foot lands, takes the weight and rolls through
        ry = lerp(-0.10, 0.15, f / 5)
        rp = curve([(0, 15), (1.2, 0), (3, 0), (5, 26)], f)
        rz = ground_foot(rp)
    else:
        ry, rp = 0.15, 26
        rz = ground_foot(26) + 0.06 * smooth(5, 7, f)
    q = smooth(0, 7, f)                          # the left foot swings through
    ly, lp = lerp(0.06, -0.17, q), lerp(26, -10, q)
    lz = lerp(0.1, ground_foot(-10), f / 7) + 0.07 * math.sin(math.pi * f / 7)
    P = {'foot_ik_L': ((0, ly, lz), rot(X, lp)), 'foot_ik_R': ((0, ry, rz), rot(X, rp))}
    k = lambda keys: curve(keys, f)
    P['body'] = ((0, 0, dz), rot(Z, k([(0, 0), (3, 4), (7, -5)])) @ rot(X, k([(0, 3), (2.5, 14), (7, 7)])))
    pose_arms(P, {'L': k([(0, -31), (3, -15), (7, 30)]), 'R': k([(0, 25), (3, 10), (7, -30)])},
              both(k([(0, -38), (3, -16), (7, 16)])),
              {'L': k([(0, 40), (3, 46), (7, 38)]), 'R': k([(0, 45), (3, 55), (7, 60)])},
              both(k([(0, -3), (3, 8), (7, 0)])))
    gz = k([(0, 0.012), (2, -0.022), (4.5, 0.006), (7, 0)])
    P['glasses'] = ((0, 0, gz), rot(X, k([(0, 2), (2.5, 5), (7, 0)])))
    return blend(P, GAIT0, smooth(4, 7, f))


def land_hard(t):
    """Landing after a long fall: a deep splat with the feet wide and the glasses slammed down the nose, the arms
    thrown out for balance, then a springy recovery into Idle."""
    f = t * 24
    k = lambda keys: curve(keys, f)
    if f < 3:
        dz = hermite(0.03, -0.20, -0.6, 0, f / 3)
    else:
        dz = k([(3, -0.20), (6, -0.185), (9, -0.195), (15, 0.01), (19, -0.045), (24, -0.03)])
    pitch = 24 * (1 - smooth(0, 1.2, f))
    wide = 0.035 * (smooth(0, 2, f) - smooth(14, 20, f))
    z = ground_foot(pitch)
    P = {'foot_ik_L': ((wide, 0, z), rot(X, pitch)), 'foot_ik_R': ((-wide, 0, z), rot(X, pitch))}
    P['body'] = ((0, 0, dz), rot(Y, k([(0, 0), (5, 3), (8, -3), (11, 2), (15, 0)]))
                 @ rot(X, k([(0, -3), (3, 16), (8, 13), (12, 4), (16, -3), (20, 1.5), (24, 0.8)])))
    pose_arms(P, both(k([(0, -8), (3.5, -22), (7.5, -5), (12, -10), (18, 5), (24, 2.5)])),
              both(k([(0, -70), (3.5, 16), (7.5, -40), (11, -34), (15.5, 6), (19.5, 12), (24, 8)])),
              both(k([(0, 35), (3.5, 48), (7.5, 20), (11, 30), (17, 12), (24, 14)])),
              both(k([(0, 0), (3.5, -22), (7.5, 14), (11, -5), (16, 5), (24, 0)])))
    gz = k([(0, 0.012), (2.5, -0.045), (6, -0.035), (10, -0.03), (13, 0.012), (16, -0.008), (19, 0.003), (24, 0)])
    P['glasses'] = ((0, 0, gz), rot(X, k([(0, 2), (3, 10), (8, 7), (13, -3), (17, 1), (24, 0)])))
    return blend(P, idle(0), smooth(19, 24, f))


# The summit dance: a 4 second loop of 12 beats (10 frames each, 180 a minute), pose to pose with snappy hits. Disco
# points with the hips popping, the running man with windmilling arms, a crouch, a hop with a full spin and the arms
# out like a helicopter, and a "ta-da" on one heel with jazz hands while the glasses bounce on the can. The arms keep
# out of the can and clear of the glasses: an arm going up goes up a little behind the glasses' temples.
PALM = {'L': Nn, 'R': PALM_R}
STANCE = 0.02                                    # the feet a little wider apart than the hips
WRING = math.radians(90)                         # the most a glove turns on its forearm


def smootherstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * t * (t * (6 * t - 15) + 10)


def arm_to(P, side, upper, fore, palm, hand=None):
    """Aims an arm in the can's space: the upper arm along `upper`, the forearm along `fore`, the palm facing `palm`
    and the fingers along `hand` (or straight on from the forearm). All are given for the left arm (+X is out) and
    mirrored for the right."""
    m = lambda d: Vector((SIGN[side] * d[0], d[1], d[2])).normalized()
    upper, fore, palm = m(upper), m(fore), m(palm)
    fingers = m(hand) if hand else fore
    Ru = aim(ARMDIR[side], upper)
    Rf = aim(ARMDIR[side], Ru.inverted() @ fore)
    # the glove follows the forearm, bent at the wrist, then turns its palm towards `palm`, but never more than a
    # quarter turn, which would wring the wrist
    hand = aim(fore, fingers) @ Ru @ Rf
    now = hand @ PALM[side]
    now, palm = now - fingers * now.dot(fingers), palm - fingers * palm.dot(fingers)
    turn = math.atan2(now.cross(palm).dot(fingers), now.dot(palm))
    hand = Matrix.Rotation(max(-WRING, min(WRING, turn)), 3, fingers) @ hand
    P[f'upper_arm_{side}'] = ((0, 0, 0), Ru)
    P[f'forearm_{side}'] = ((0, 0, 0), Rf)
    P[f'hand_{side}'] = ((0, 0, 0), (Ru @ Rf).inverted() @ hand)


def arm_keys(P, keys, b):
    """Both arms through (beat, (upper, fore, palm)) keys, eased from one pose to the next."""
    i = max([j for j, k in enumerate(keys) if k[0] <= b], default=0)
    if i + 1 < len(keys) and b > keys[i][0]:
        w = smooth(keys[i][0], keys[i + 1][0], b)
        pose = [Vector(a).lerp(Vector(c), w) for a, c in zip(keys[i][1], keys[i + 1][1])]
    else:
        pose = keys[i][1]
    for side in 'LR':
        arm_to(P, side, *pose)


def foot_at(P, side, y=0.0, z=0.0, pitch=0.0, spin=0.0, stance=STANCE):
    """Foot IK: y back (+) or forward (-) and z up from the rest ankle, toes down by pitch with the ankle lifted so the
    toe (or the heel) stays on the ground, and the whole stance turned by spin degrees about the can's axis."""
    at = Vector((SIGN[side] * (0.13 + stance), y, z + ground_foot(pitch)))
    P[f'foot_ik_{side}'] = (rot(Z, spin) @ at - Vector((SIGN[side] * 0.13, 0, 0)), rot(Z, spin) @ rot(X, pitch))


def dip(u):
    """The knees giving after a hit: 0 on the beat, down and back up within half a beat."""
    return math.sin(math.pi * min(1.0, u / 0.5))


UP_ARM = ((0.85, 0.2, 0.48), (0.5, 0.08, 0.86), (-0.6, -0.8, 0))        # to the sky, the elbow out past the glasses
DOWN_ARM = ((0.6, -0.35, -0.72), (0.55, -0.5, -0.67), (0, 0.6, -0.4))   # at the ground, out in front
POINT_ARM = ((0.62, 0.28, 0.73), (0.3, 0.12, 0.95), (-0.6, -0.8, 0))    # pointing up, behind the glasses' temple


def disco(b):
    """Beats 0-4: disco points. The right arm to the sky and the left at the ground, then the other way round, the
    hips popping out on the side of the arm that points down and the other heel popping up."""
    k = min(3, math.floor(b))
    u = b - k
    s0 = 1 if k % 2 == 0 else -1                 # 1: the right arm up
    c = s0 * (1 + 0.12 * (1 - smooth(0, 0.35, u)))            # hits the pose a little past it, then settles
    if k < 3:
        c = lerp(c, -s0 * 1.12, smooth(0.55, 1, u))
    P = {}
    for side in 'LR':
        h = (1 - SIGN[side] * c) / 2             # how far up this arm is
        arm_to(P, side, *[Vector(d).lerp(Vector(e), h) for d, e in zip(DOWN_ARM, UP_ARM)])
        foot_at(P, side, pitch=24 * smooth(0, 1, -SIGN[side] * c))
    P['body'] = ((0.035 * c, 0, -0.035 - 0.05 * dip(u)), rot(Z, -8 * c) @ rot(Y, -9 * c) @ rot(X, 2))
    P['glasses'] = ((0, 0, 0.02 * dip(u)), rot(Y, 3 * c))
    return P


WM_AXIS = Vector((math.cos(math.radians(35)), math.sin(math.radians(35)), 0))   # the windmill turns round a cone
WM_FWD = Vector((math.sin(math.radians(35)), -math.cos(math.radians(35)), 0))   # pointing out and back, so its top
                                                                                # is behind the glasses' temple


def windmill(phi, alpha=55):
    """Direction of a windmilling left arm: up at phi = 0, forward-out at pi / 2, down at pi, back at 3 pi / 2."""
    a = math.radians(alpha)
    return math.cos(a) * WM_AXIS + math.sin(a) * (math.cos(phi) * Vector(Z) + math.sin(phi) * WM_FWD)


def running_man(b):
    """Beats 4-8: the running man, a knee up and a stomp on every beat while the other foot slides back, the arms
    windmilling forward, one up while the other is down."""
    P = {}
    for side, off in (('L', 0.0), ('R', 0.5)):
        p = ((b - 4) / 2 + off) % 1.0
        if p < 0.5:                              # planted, sliding back, the heel coming up
            q = p / 0.5
            foot_at(P, side, lerp(-0.09, 0.13, smooth(0, 1, q)), 0.0, 30 * smooth(0.55, 1, q))
        else:                                    # the knee comes up, the foot forward, and it stomps down
            q = (p - 0.5) / 0.5
            foot_at(P, side, 0.13 - 0.22 * smooth(0, 0.75, q), 0.22 * math.sin(math.pi * q ** 0.75),
                    30 * (1 - smooth(0, 0.9, q)))
        phi = math.pi * (b - 4) + (0 if side == 'L' else math.pi)
        travel = math.sin(math.radians(55)) * (-math.sin(phi) * Vector(Z) + math.cos(phi) * WM_FWD)
        arm_to(P, side, windmill(phi), windmill(phi - 0.45), travel)
    u, w = b % 1, math.pi * (b - 4)
    P['body'] = ((0, 0, -0.05 - 0.045 * dip(u)), rot(Z, 7 * math.sin(w)) @ rot(Y, 3 * math.cos(w)) @ rot(X, -4))
    P['glasses'] = ((0, 0, 0.018 * dip(u)), rot(X, 3 * dip(u)))
    return P


CROUCH_ARM = ((0.45, 0.5, -0.74), (0.35, 0.6, -0.72), (-1, 0, 0))
HELI_ARM = ((0.96, 0.05, 0.26), (0.98, 0.0, 0.18), (0, 0, -1))
LAND_ARM = ((0.8, -0.15, -0.55), (0.75, -0.3, -0.58), (0, 0, -1))
UP, DOWN = 8.6, 9.6                              # the hop's take-off and touch-down, in beats


def hop_spin(b):
    """Beats 8-10: a crouch with the arms swung back, the push off the toes, a full spin in the air with the arms out
    like a helicopter, and a squashy landing on the toes."""
    u = min(1.0, max(0.0, (b - UP) / (DOWN - UP)))
    air = UP < b < DOWN
    h = 0.8 * u * (1 - u)                        # 0.2 high, a third of a second in the air
    spin = 360 * smootherstep(0, 1, u)
    P = {}
    for side, y0 in (('L', -0.05), ('R', 0.03)):
        if b < UP:                               # crouch, then roll onto the toes
            foot_at(P, side, y0, 0.0, 30 * smooth(8.45, UP, b))
        elif air:                                # the feet tuck up a little
            foot_at(P, side, lerp(y0, 0, smooth(0, 0.4, u)), h + 0.06 * math.sin(math.pi * u), lerp(30, 20, u), spin)
        else:                                    # toes first, then flat
            foot_at(P, side, 0.0, 0.0, 20 * (1 - smooth(DOWN, DOWN + 0.15, b)))
    if b < 8.45:
        dz = lerp(-0.05, -0.16, smooth(8.0, 8.45, b))
    elif b < UP:
        dz = lerp(-0.16, -0.02, smooth(8.45, UP, b))
    elif air:
        dz = h - 0.02
    else:
        dz = curve([(DOWN, -0.02), (DOWN + 0.15, -0.17), (DOWN + 0.5, -0.05)], b)
    lean = curve([(8.0, -4), (8.45, 12), (UP, -2), (DOWN, 0), (DOWN + 0.15, 8), (DOWN + 0.5, 0)], b)
    P['body'] = ((0, 0, dz), rot(Z, spin) @ rot(X, lean))
    arm_keys(P, [(8.0, CROUCH_ARM), (8.45, CROUCH_ARM), (UP + 0.15, HELI_ARM), (DOWN - 0.05, HELI_ARM),
                 (DOWN + 0.15, LAND_ARM)], b)
    # the glasses float up in the crouch and in the air, lag behind the spin and slam down at the landing
    lag = -14 * (30 * u * u * (1 - u) * (1 - u)) / 1.875 if air else 0
    gz = curve([(8.0, 0), (8.45, 0.02), (UP, -0.015), (UP + 0.4, 0.035), (DOWN, 0.02), (DOWN + 0.15, -0.03),
                (DOWN + 0.4, 0.0)], b)
    P['glasses'] = ((0, 0, gz), rot(Z, lag))
    return P


TADA_ARM = ((0.75, 0.15, 0.64), (0.42, 0.05, 0.9), (0, -1, 0.1))


def tada(b):
    """Beats 10-12: ta-da! On the right foot with the left heel out in front, chest out, the arms up in a V with jazz
    hands shaking, and the glasses bouncing on the can like a ball. Then the left foot comes back for the first
    disco point."""
    P = {}
    out, back = smooth(9.85, 10.15, b), smooth(11.4, 11.85, b)
    w = out - back
    step = math.sin(math.pi * out) if back == 0 else math.sin(math.pi * back)
    foot_at(P, 'L', -0.15 * w, 0.07 * step, -25 * w)
    foot_at(P, 'R', 0.02 * w)
    x = b - 10.0
    P['body'] = ((0, 0, -0.06 + 0.012 * math.sin(4 * math.pi * x) * w), rot(Z, 10 * w) @ rot(Y, 4 * w)
                 @ rot(X, -7 * w))
    shake = math.radians(28) * math.sin(4 * math.pi * x)       # two shakes a beat
    fore = Vector(TADA_ARM[1]).normalized()
    arm_to(P, 'L', TADA_ARM[0], TADA_ARM[1], Matrix.Rotation(shake, 3, fore) @ Vector(TADA_ARM[2]))
    arm_to(P, 'R', TADA_ARM[0], TADA_ARM[1], Matrix.Rotation(-shake, 3, fore) @ Vector(TADA_ARM[2]))
    bounce = abs(math.sin(2.5 * math.pi * max(0.0, x))) * math.exp(-2.2 * max(0.0, x))
    P['glasses'] = ((0, 0, 0.045 * bounce), rot(X, -5 * bounce))
    return P


def dance(t):
    b = 12 * t
    if b < 3.6:
        return disco(b)
    if b < 4.0:
        return blend(disco(b), running_man(b), smooth(3.6, 4.0, b))
    if b < 8.0:
        return running_man(b)
    if b < 8.35:
        return blend(running_man(b), hop_spin(b), smooth(8.0, 8.35, b))
    if b < 9.85:
        return hop_spin(b)
    if b < 10.15:
        return blend(hop_spin(b), tada(b), smooth(9.85, 10.15, b))
    if b < 11.45:
        return tada(b)
    return blend(tada(b), disco(0.0), smooth(11.45, 12.0, b))


# Idle fidgets, for standing about at base camp: one-shots that start and end in the Idle pose.
def two_bone(S, W, pole):
    """The elbow for a shoulder at S and a wrist at W (pulled in if out of reach), bending towards pole."""
    d = W - S
    L = min(d.length, UPPER + FORE - 1e-4)
    dn = d.normalized()
    a = (UPPER * UPPER - FORE * FORE + L * L) / (2 * L)
    side = (Vector(pole) - dn * dn.dot(Vector(pole))).normalized()
    return S + dn * a + side * math.sqrt(max(0.0, UPPER * UPPER - a * a)), S + dn * L


def reach(P, side, wrist, pole, palm, hand=None):
    """An arm reaching its wrist to a point, given for the left arm and mirrored for the right."""
    elbow, wrist = two_bone(SHOULDER, Vector(wrist), pole)
    arm_to(P, side, elbow - SHOULDER, wrist - elbow, palm, hand)


def push_glasses(t):
    """The glasses have slipped down the nose: the right glove comes up and pushes them back, a satisfied nod, and
    the arm goes back down."""
    f = t * 54
    P = idle(0)
    up = smooth(0, 13, f) * (1 - smooth(32, 46, f))
    lift = 0.03 * smooth(12, 16, f)
    A = dict(P)
    reach(A, 'R', (0.47, -0.45, 0.80 + lift), (0.6, 0.2, -0.8), (-0.3, 0.9, -0.2), (-0.35, 0.35, 0.87))
    P = blend(P, A, up)
    gz = curve([(0, 0), (10, -0.014), (13, -0.014), (16, 0.004), (22, 0), (54, 0)], f)
    nod = curve([(0, 0), (10, 4), (17, -3), (26, 2), (34, 0), (54, 0)], f)
    P['body'] = ((0, 0, -0.03), rot(X, nod))
    P['glasses'] = ((0, 0, gz), rot(X, curve([(0, 0), (10, 3), (16, -2), (24, 0)], f)))
    return blend(P, idle(0), smooth(46, 54, f))


def look_up(t):
    """Looking up at the peak: leaning back with the glasses tipped up, the right arm pointing at the top, a little
    wobble of awe, and back."""
    f = t * 66
    P = idle(0)
    up = smooth(0, 14, f) * (1 - smooth(46, 60, f))
    A = dict(P)
    arm_to(A, 'R', *POINT_ARM)
    arm_to(A, 'L', (0.75, -0.2, -0.62), (0.6, -0.45, -0.66), (0, 0.6, -0.4))
    P = blend(P, A, up)
    wobble = math.sin(2 * math.pi * f / 16) * smooth(14, 22, f) * (1 - smooth(40, 48, f))
    P['body'] = ((0, 0, -0.03 - 0.02 * up), rot(Z, 4 * wobble) @ rot(X, -12 * up))
    P['glasses'] = ((0, 0, 0.006 * up), rot(X, -6 * up + 2 * wobble))
    return blend(P, idle(0), smooth(60, 66, f))


def tap_foot(t):
    """Waiting: the right toes tap four times, the can bobbing along and looking about."""
    f = t * 48
    taps = [6, 14, 22, 30]
    up = smooth(0, 4, f) * (1 - smooth(32, 38, f))
    k = min(range(4), key=lambda i: abs(f - taps[i]))
    tap = 1 - math.exp(-((f - taps[k]) / 2.2) ** 2)              # 0 on a tap, 1 between
    P = idle(0)
    foot_at(P, 'R', pitch=-26 * tap * up, stance=0)
    bob = (1 - tap) * up
    look = curve([(0, 0), (8, -10), (20, -10), (26, 8), (36, 8), (44, 0), (48, 0)], f)
    P['body'] = ((0, 0, -0.03 - 0.012 * bob), rot(Z, look) @ rot(Y, 1.5 * bob))
    P['glasses'] = ((0, 0, 0.006 * bob), rot(Y, -1 * look * 0.2))
    return blend(P, idle(0), smooth(40, 48, f))


def channelbag_fcurves(act):
    try:
        from bpy_extras.anim_utils import action_get_channelbag_for_slot
        return action_get_channelbag_for_slot(act, act.slots[0]).fcurves
    except Exception:
        return act.fcurves


arm.animation_data_create()
# name, pose function, frames (at 30 fps), loops
CLIPS = [('Idle', idle, 60, True), ('Walk', walk, 24, True), ('Run', run, 16, True),
         ('JumpStart', jump_start, 10, False), ('LeapStart', leap_start, 24, False), ('Fall', fall, 24, True),
         ('Land', land, 10, False), ('LeapLand', leap_land, 7, False), ('LandHard', land_hard, 24, False),
         ('Wave', wave, 48, True), ('Dance', dance, 120, True), ('PushGlasses', push_glasses, 54, False),
         ('LookUp', look_up, 66, False), ('TapFoot', tap_foot, 48, False)]
actions = {}
for name, fn, frames, loops in CLIPS:
    # Sampled at 60 fps. The original loops keep a key per 30 fps frame with straight lines between, as they always
    # played; the jump clips, the dance and the fidgets get a key on every frame, so quick moves like the crouch
    # before a jump turn smoothly.
    frames, step = frames * 2, 2 if name in ('Idle', 'Walk', 'Run', 'Wave') else 1
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data.action = act
    prev = {}
    for frame in range(0, frames + 1, step):
        P = fn(frame / frames)
        for bname in ANIM:
            pb = arm.pose.bones[bname]
            loc, q = pose_to_local(pb, *P.get(bname, ((0, 0, 0), I3)))
            if bname in prev and prev[bname].dot(q) < 0:
                q.negate()
            prev[bname] = q
            pb.location = loc
            pb.rotation_quaternion = q
            pb.keyframe_insert('location', frame=frame, group=bname)
            pb.keyframe_insert('rotation_quaternion', frame=frame, group=bname)
    act.use_frame_range = True
    act.frame_start, act.frame_end = 0, frames
    act.use_cyclic = loops
    for fc in channelbag_fcurves(act):
        if loops:
            fc.modifiers.new('CYCLES')
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
        fc.update()
    actions[name] = act

# speeds the game should move the character at so the feet don't slide (units per second)
arm['walk_speed'] = round(0.28 / (0.56 * 24 / 30), 3)
arm['run_speed'] = round(0.40 / (0.36 * 16 / 30), 3)
# the jump: when the take-offs leave the ground (seconds), and the flight the clips were made for
arm['jump_takeoff'], arm['leap_takeoff'] = round(JUMP_TAKEOFF / 30, 3), round(LEAP_TAKEOFF / 30, 3)
arm['jump_gravity'], arm['jump_height'], arm['run_jump_height'] = GRAVITY, JUMP_HEIGHT, RUN_JUMP_HEIGHT
arm['hard_landing_speed'] = HARD_LANDING
print('walk speed', arm['walk_speed'], 'run speed', arm['run_speed'])

arm.animation_data.action = actions['Idle']
scene.frame_start, scene.frame_end = 0, 120
for pb in arm.pose.bones:
    pb.location = (0, 0, 0)
    pb.rotation_quaternion = (1, 0, 0, 0)
scene.frame_set(0)

# ---------------------------------------------------------------- save and export

print('vertices', len(me.vertices), 'triangles', sum(len(p.vertices) - 2 for p in me.polygons))
# the Shading workspace's file browser remembers this machine's folders (and so the user name); keep them out of
# the shared .blend. The whole buffer is saved, so fill it before shortening it, or the old path stays behind.
for screen in bpy.data.screens:
    for area in screen.areas:
        for space in area.spaces:
            if space.type == 'FILE_BROWSER' and space.params:
                size = space.params.bl_rna.properties['directory'].length_max
                space.params.directory = b'/' * (size - 1)
                space.params.directory = b'//'
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'mnot.blend'))
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, 'mnot.glb'),
    export_format='GLB',
    export_yup=True,
    export_apply=True,
    export_skins=True,
    export_def_bones=True,
    export_rest_position_armature=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_force_sampling=True,
    export_frame_range=False,
    export_anim_slide_to_zero=False,
    export_extras=True,
    export_cameras=False,
    export_lights=False,
)
print('done', OUT)
