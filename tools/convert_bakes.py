from PIL import Image
import os, sys, cv2, numpy as np
H={'wall_rad':7,'ceil_rad':7,'floor_irr':6,'archL_rad':4,'archR_rad':4,'archC_rad':4}
SRC='bake2'; specs={'wall_rad':(4096,1024),'ceil_rad':(1024,1024),'floor_irr':(2048,2048),'floor_alb':(1024,1024),'archL_rad':(2048,2048),'archR_rad':(2048,2048),'archC_rad':(2048,2048)}
names = sys.argv[1:] or list(specs)
for n in names:
    p=f'{SRC}/{n}.png'
    if not os.path.exists(p): print('missing', p); continue
    im=Image.open(p).convert('RGB'); hi=specs[n]
    if n in H:
        a=cv2.fastNlMeansDenoisingColored(np.asarray(im)[...,::-1].copy(), None, H[n], H[n], 7, 21); im=Image.fromarray(a[...,::-1])
    im.resize(hi, Image.LANCZOS).save(f'assets/hi/{n}.webp', quality=90, method=6)
    im.resize((hi[0]//2, hi[1]//2), Image.LANCZOS).save(f'assets/lo/{n}.webp', quality=85, method=6)
    print(n, os.path.getsize(f'assets/hi/{n}.webp'), os.path.getsize(f'assets/lo/{n}.webp'))
