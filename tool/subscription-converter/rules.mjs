const matchTypes = new Set(['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'IP-CIDR', 'IP-CIDR6', 'PROCESS-NAME', 'GEOIP']);

export function applyRulePreset(config, preset) {
  const group = config['proxy-groups'][0].name;
  const rules = [];
  let skipped = 0;
  for (const block of preset) {
    const target = block.policy === 'proxy' ? group : block.policy;
    for (const original of block.lines) {
      const line = original.trim();
      if (!line || /^[#;]/.test(line) || line.startsWith('//')) continue;
      const [type, value, option, ...rest] = line.split(',').map(field => field.trim());
      if (!matchTypes.has(type) || !value || rest.length || (option && option !== 'no-resolve')) {
        skipped++;
        continue;
      }
      rules.push([type, value, target, option].filter(Boolean).join(','));
    }
  }
  config.rules = [...rules, 'GEOIP,CN,DIRECT', 'MATCH,' + group];
  return { skipped, count: rules.length };
}
