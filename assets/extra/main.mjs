import { mountForm,node } from './ui.mjs';
import { basic } from './basic.mjs';
import { images } from './images.mjs';
import { media } from './media.mjs';
import { widgets } from './widgets.mjs';
import { reference } from './reference.mjs';
import { services } from './services.mjs';

const mount = document.getElementById('tool-content');
const slug = mount.dataset.tool;
const spec = { ...basic, ...images, ...media, ...services, ...reference }[slug];

if (spec) mountForm(mount, spec);
else if (widgets[slug]) widgets[slug](mount);
else mount.append(node('p', {role:'status'}, '工具暂时不可用。'));
