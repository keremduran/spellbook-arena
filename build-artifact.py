"""Packs dist/ into a single-page artifact: <out>/index.html with inlined CSS plus game.js."""
import glob, shutil, sys, os
out, title = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
css = open(glob.glob('dist/assets/index-*.css')[0]).read()
shutil.copy(glob.glob('dist/assets/index-*.js')[0], os.path.join(out, 'game.js'))
open(os.path.join(out, 'page.html'), 'w').write(f'''<title>{title}</title>
<meta name="theme-color" content="#0b0f14">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;800&family=Inter:wght@400;600;800&display=swap">
<style>{css}</style>
<div id="game"></div>
<div id="ui"></div>
<script type="module" src="game.js"></script>
''')
