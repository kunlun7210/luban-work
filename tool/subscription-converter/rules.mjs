const matchTypes = new Set(['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'IP-CIDR', 'IP-CIDR6', 'PROCESS-NAME', 'GEOIP']);

export function applyRulePreset(config, { definition, lists }) {
  const used = new Set(config.proxies.map(node => node.name));
  const names = new Map();
  for (const [original] of definition.groups) {
    let name = original;
    while (used.has(name)) name += ' · 策略';
    names.set(original, name);
    used.add(name);
  }
  config['proxy-groups'] = definition.groups.map(([title, type, ...items]) => {
    const group = { name: names.get(title), type, proxies: [] };
    if (type === 'url-test') {
      const [parameters, url] = [items.pop(), items.pop()];
      const [interval, , tolerance] = parameters.split(',').map(Number);
      Object.assign(group, { url, interval, tolerance });
    }
    for (const item of items) {
      if (item.startsWith('[]')) {
        const target = item.slice(2);
        group.proxies.push(names.get(target) || target);
      } else {
        const pattern = new RegExp(item, 'i');
        group.proxies.push(...config.proxies.filter(node => pattern.test(node.name)).map(node => node.name));
      }
    }
    group.proxies = [...new Set(group.proxies)];
    if (!group.proxies.length) {
      group.type = 'select';
      group.proxies = ['DIRECT'];
      for (const field of ['url', 'interval', 'tolerance']) delete group[field];
    }
    return group;
  });
  const rules = [];
  let skipped = 0;
  for (const [policy, input, inline] of definition.blocks) {
    const target = names.get(policy) || policy;
    for (const original of inline ? [input] : lists[input]) {
      const line = original.trim();
      if (!line || /^(#|;|\/\/)/.test(line)) continue;
      if (line === 'FINAL') { rules.push('MATCH,' + target); continue; }
      const [type, value, option, ...rest] = line.split(',').map(field => field.trim());
      if (!matchTypes.has(type) || !value || rest.length || (option && option !== 'no-resolve')) {
        skipped++;
        continue;
      }
      rules.push([type, value, target, option].filter(Boolean).join(','));
    }
  }
  config.rules = rules;
  return { skipped, count: rules.length };
}
