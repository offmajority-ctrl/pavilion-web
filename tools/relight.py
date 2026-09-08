"""Relight pavilion_v2 to the dark-studio reference and either render a preview or bake.
usage: python3 relight.py preview [samples]  |  python3 relight.py bake <target> ...
targets: wall ceil floor floor_alb archL archR archC
"""
import bpy, os, sys, time, math, numpy as np

ROOT = '/home/claude/pav2'
OUT = os.path.join(ROOT, 'bake2'); os.makedirs(OUT, exist_ok=True)
K = 400.0

P = dict(
    world=0.0,            # world background strength
    fill=30.0,            # RoomFill energy (was 4800)
    wall_value=0.04,      # wall albedo multiplier (plaster ~0.6 -> ~0.06)
    screen_rgb=(1.0, 0.88, 0.75), screen_strength=0.72,
    screen_light=520.0,   # ScreenLight_k (was 900)
    base_wash=520.0,      # BaseWash_k (was 1400)
    side_glow=35.0, side_size=2.5,      # SideGlow (was 230)
    top_beam=380000.0, pool=300000.0, pool_spot=26.0,
    key=1600.0, key_spot=26.0,   # soft front light on the figure (from the room centre)
    floor_value=0.46,     # floor albedo multiplier
    floor_rough=(0.22, 0.38),  # Map Range.001 To Min/Max for roughness
    coat=0.6,
    decal_shadow=True,    # contact-shadow decals cast (partial) shadows into the floor bake
)


def load():
    bpy.ops.wm.open_mainfile(filepath=os.path.join(ROOT, 'corp', 'pavilion_v2.blend'))
    for im in bpy.data.images:
        if 'smooth_concrete' in im.filepath:
            im.filepath = os.path.join(ROOT, 'bake', os.path.basename(im.filepath)); im.reload()
    return bpy.context.scene


def relight(sc, with_corp=True):
    w = sc.world
    for n in w.node_tree.nodes:
        if n.type == 'BACKGROUND': n.inputs['Strength'].default_value = P['world']; n.inputs['Color'].default_value = (0.6, 0.45, 0.32, 1)
    for o in sc.objects:
        if o.type != 'LIGHT': continue
        n, l = o.name, o.data
        if n == 'RoomFill': l.energy = P['fill']
        elif n.startswith('ScreenLight_'): l.energy = P['screen_light']; l.color = (1.0, 0.92, 0.82)
        elif n.startswith('BaseWash_'): l.energy = P['base_wash']
        elif n.startswith('SideGlow_'): l.energy = P['side_glow']; l.size = P['side_size']
        elif n.startswith('TopBeam_'): l.energy = P['top_beam']
        elif n.startswith('PoolLight_'): l.energy = P['pool']; l.spot_size = math.radians(P['pool_spot']); l.spot_blend = 0.9
    # a soft front key per stage so the figure's face reads (the reference is lit from the front as well as above)
    for k in range(4):
        nme = f'ArchKey_{k}'
        if nme in bpy.data.objects: continue
        l = bpy.data.lights.new(nme, 'SPOT'); l.energy = P['key']; l.color = (1.0, 0.9, 0.78); l.spot_size = math.radians(P['key_spot']); l.spot_blend = 0.85; l.shadow_soft_size = 2.0
        o = bpy.data.objects.new(nme, l); sc.collection.objects.link(o)
        a = k * math.pi / 2; o.location = (math.sin(a) * 1.5, math.cos(a) * 1.5, 5.0)
        tgt = (math.sin(a) * 16.8, math.cos(a) * 16.8, 2.4)
        d = [tgt[i] - o.location[i] for i in range(3)]
        import mathutils; o.rotation_euler = mathutils.Vector(d).to_track_quat('-Z', 'Y').to_euler()
    # walls: darken the plaster
    m = bpy.data.materials['Room_Plaster']; nt = m.node_tree
    mix = nt.nodes['Mix']; bsdf = nt.nodes['Principled BSDF']
    hs = nt.nodes.get('DARK') or nt.nodes.new('ShaderNodeHueSaturation'); hs.name = 'DARK'
    hs.inputs['Value'].default_value = P['wall_value']
    nt.links.new(mix.outputs['Result'], hs.inputs['Color']); nt.links.new(hs.outputs['Color'], bsdf.inputs['Base Color'])
    # floor: darker, glossier
    m = bpy.data.materials['Floor_Resin']; nt = m.node_tree
    nt.nodes['Hue/Saturation/Value'].inputs['Value'].default_value = P['floor_value']
    mr = nt.nodes['Map Range.001']; mr.inputs['To Min'].default_value = P['floor_rough'][0]; mr.inputs['To Max'].default_value = P['floor_rough'][1]
    nt.nodes['Principled BSDF'].inputs['Coat Weight'].default_value = P['coat']
    # screens: flat warm white
    for m in bpy.data.materials:
        if not m.name.startswith('Screen_'): continue
        nt = m.node_tree; mix = nt.nodes['Mix']
        rgb = nt.nodes.get('WHITE') or nt.nodes.new('ShaderNodeRGB'); rgb.name = 'WHITE'
        rgb.outputs[0].default_value = (*P['screen_rgb'], 1)
        # the Mix node's colour input A
        a = [s for s in mix.inputs if s.name == 'A' and s.type == 'RGBA'][0]
        for l in list(nt.links):
            if l.to_socket == a: nt.links.remove(l)
        nt.links.new(rgb.outputs[0], a)
        nt.nodes['Emission'].inputs['Strength'].default_value = P['screen_strength']
    # contact-shadow decals: shadow-only casters (partial, by the 'shade' attribute)
    for o in sc.objects:
        if o.name.startswith(('ScreenShadow_', 'ArchShadow_')):
            o.visible_camera = False; o.visible_shadow = P['decal_shadow']; o.visible_diffuse = False; o.visible_glossy = False
    if with_corp and 'CorpArch' not in bpy.data.objects:
        with bpy.data.libraries.load(os.path.join(ROOT, 'corp', 'corp_joined.blend'), link=False) as (df, dt):
            dt.objects = ['CorpArch']
        arch = dt.objects[0]; sc.collection.objects.link(arch)
        arch.location = (16.8, 0, 0); arch.rotation_euler = (0, 0, -math.pi / 2)
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'
    sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'None'


def encode_save(img, path, vmax):
    px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(-1, 4)
    rgb = np.log1p(np.clip(px[:, :3].astype(np.float64), 0, vmax) * K) / np.log1p(vmax * K)
    rgb = np.clip(rgb + (np.random.rand(*rgb.shape) - 0.5) / 255.0, 0, 1)
    out = bpy.data.images.new('enc', img.size[0], img.size[1], alpha=False, float_buffer=False); out.colorspace_settings.name = 'Non-Color'
    o = np.ones_like(px); o[:, :3] = rgb.astype(np.float32); out.pixels.foreach_set(o.ravel()); out.filepath_raw = path; out.file_format = 'PNG'; out.save()
    bpy.data.images.remove(out)
    return float(np.percentile(px[:, :3], 50)), float(np.percentile(px[:, :3], 99)), float(px[:, :3].max())


def bake(sc, target, samples):
    cfg = {
        'wall': ('RoomWall', 'Room_Plaster', (4096, 1024), 6.0, 'wall_rad', True),
        'ceil': ('RoomCeiling', 'Room_Plaster', (1024, 1024), 6.0, 'ceil_rad', True),
        'floor': ('Floor', 'Floor_Resin', (2048, 2048), 24.0, 'floor_irr', False),
        'floor_alb': ('Floor', 'Floor_Resin', (2048, 2048), None, 'floor_alb', True),
        'archL': ('Arch_0_left', 'Olive limestone - baked PBR', (2048, 2048), 6.0, 'archL_rad', True),
        'archR': ('Arch_0_right', 'Olive limestone - baked PBR', (2048, 2048), 6.0, 'archR_rad', True),
        'archC': ('CorpArch', None, (2048, 2048), 6.0, 'archC_rad', True),
    }
    obn, matn, size, vmax, name, color = cfg[target]
    ob = bpy.data.objects[obn]; me = ob.data
    mat = bpy.data.materials[matn] if matn else me.materials[0]
    for o in sc.objects:
        if o.name.startswith(('BeamCone_', 'BeamHaze_')) or o.name == 'Ground': o.hide_render = True
    sc.cycles.samples = samples; sc.cycles.use_denoising = False
    b = sc.render.bake; b.use_pass_direct = vmax is not None; b.use_pass_indirect = vmax is not None; b.use_pass_color = color; b.margin = 16; b.use_clear = True
    lm = 'LM' if 'LM' in me.uv_layers else me.uv_layers[0].name
    me.uv_layers.active = me.uv_layers[lm]
    nt = mat.node_tree
    node = nt.nodes.get('BAKE_TARGET') or nt.nodes.new('ShaderNodeTexImage'); node.name = 'BAKE_TARGET'
    img = bpy.data.images.new('BAKE_' + name, *size, alpha=False, float_buffer=True); img.colorspace_settings.name = 'Non-Color'
    node.image = img; nt.nodes.active = node
    uvb = nt.nodes.get('BAKE_UV') or nt.nodes.new('ShaderNodeUVMap'); uvb.name = 'BAKE_UV'; uvb.uv_map = lm; nt.links.new(uvb.outputs[0], node.inputs['Vector'])
    if target.startswith('arch') and matn:   # both olive halves share the material; make sure only this object is baked
        pass
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    t = time.time(); bpy.ops.object.bake(type='DIFFUSE')
    if vmax is None:
        # albedo: plain sRGB PNG
        px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(-1, 4)
        lin = np.clip(px[:, :3], 0, 1); srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - 0.055)
        out = bpy.data.images.new('enc', *size, alpha=False, float_buffer=False); out.colorspace_settings.name = 'Non-Color'
        o = np.ones_like(px); o[:, :3] = srgb.astype(np.float32); out.pixels.foreach_set(o.ravel()); out.filepath_raw = os.path.join(OUT, name + '.png'); out.file_format = 'PNG'; out.save()
        print(name, round(time.time() - t, 1), float(lin.mean()), flush=True)
    else:
        print(name, round(time.time() - t, 1), encode_save(img, os.path.join(OUT, name + '.png'), vmax), flush=True)
    bpy.data.images.remove(img)


if __name__ == '__main__':
    args = sys.argv[1:]
    mode = args[0] if args else 'preview'
    sc = load(); relight(sc)
    if mode == 'preview':
        samples = int(args[1]) if len(args) > 1 else 64
        cam = args[2] if len(args) > 2 else 'Cam_0_Wedding'
        sc.camera = bpy.data.objects[cam]
        sc.render.resolution_x, sc.render.resolution_y = 960, 512; sc.render.resolution_percentage = 100
        sc.cycles.samples = samples; sc.cycles.use_denoising = True
        try: sc.cycles.denoiser = 'OPENIMAGEDENOISE'
        except Exception: pass
        sc.render.image_settings.file_format = 'JPEG'; sc.render.image_settings.quality = 92
        sc.render.filepath = os.path.join(OUT, f'preview_{cam}.jpg')
        t = time.time(); bpy.ops.render.render(write_still=True); print('rendered', round(time.time() - t, 1), sc.render.filepath, flush=True)
    else:
        samples = int(os.environ.get('SAMPLES', '64'))
        for tgt in args[1:]: bake(sc, tgt, samples)
