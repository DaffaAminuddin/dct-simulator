/**
 * Technician laptop applications. Every result is computed from the engine
 * (reachability, DHCP, console), never scripted.
 */
import { CircleAlert, Globe, KeyRound, Network, Play, Terminal } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout, Mono } from '@/components/ui/misc';
import { KV } from '@/components/ui/panel';
import { Input, Select } from '@/components/ui/select';
import { hash32 } from '@/simulation/core/util';
import { prefixToMask } from '@/simulation/networking/ip';
import { CREDENTIALS, type CredentialProfile, httpsGet, ping, type ProbeResult, sshConnect } from '@/simulation/networking/Reachability';
import { snapshotCache } from '@/simulation/networking/Vlan';
import { consoleScreen } from '@/simulation/workstation/Console';
import { laptopPort } from '@/simulation/workstation/Workstation';
import { useAct, useDevMode } from '@/stores/hardwareStore';
import { getSim, useSim } from '@/stores/simulationStore';
import type { WorkstationNetConfig } from '@/types/simulation';
import { cn } from '@/utils/cn';
import { formatSpeed, PORT_STATE_TEXT, portTone } from '@/utils/format';
import { BmcWebUi } from './BmcWebUi';

function Output({ lines, ok }: { lines: string[]; ok?: boolean }) {
  return (
    <pre className={cn('max-h-[320px] overflow-auto rounded-[4px] border border-border bg-black/60 p-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap', ok === false ? 'text-[#f0b3ae]' : 'text-[#c7d2cc]')} data-testid="laptop-output">
      {lines.join('\n')}
    </pre>
  );
}

function Why({ result }: { result: ProbeResult | null }) {
  const devMode = useDevMode();
  if (!result || result.ok || !devMode) return null;
  return (
    <Callout tone="warn" title="Ground truth (developer mode)">
      {result.why}
    </Callout>
  );
}

export function macFor(serial: string): string {
  const h = hash32(serial);
  const h2 = hash32(`${serial}#mac`);
  return ['02', (h & 255).toString(16), ((h >>> 8) & 255).toString(16), ((h >>> 16) & 255).toString(16), (h2 & 255).toString(16), ((h2 >>> 8) & 255).toString(16)].map((x) => x.padStart(2, '0')).join(':');
}

// ---------------------------------------------------------------------------
export function NetworkApp() {
  const act = useAct();
  const ws = useSim((s) => s.workstation);
  const eth = useSim((s) => laptopPort(s, 'eth0'));
  const peer = useSim((s) => (eth?.peerPortId ? s.ports[eth.peerPortId] : undefined));
  const peerEq = useSim((s) => (peer ? s.equipment[peer.equipmentId] : undefined));
  const serial = useSim((s) => s.equipment[s.workstation.equipmentId]?.serial ?? '');
  const [form, setForm] = useState<WorkstationNetConfig>(ws.net);
  const [vlanText, setVlanText] = useState(ws.net.vlan === null ? '' : String(ws.net.vlan));
  useEffect(() => {
    setForm(ws.net);
    setVlanText(ws.net.vlan === null ? '' : String(ws.net.vlan));
  }, [ws.net]);

  const apply = (e: FormEvent) => {
    e.preventDefault();
    act({ type: 'workstation/configure', net: { ...form, prefix: Number(form.prefix), vlan: vlanText.trim() === '' ? null : Number(vlanText) } }, 'Network settings applied');
  };
  const eff = ws.effective;

  return (
    <div className="space-y-3">
      <div className="rounded-[5px] border border-border bg-surface-2 p-2.5">
        <div className="mb-1.5 flex items-center gap-2">
          <Network className="size-4 text-muted" />
          <span className="font-medium">eth0</span>
          {eth && <Badge tone={portTone(eth.state)}>{PORT_STATE_TEXT[eth.state]}</Badge>}
          {eth?.state === 'link_up' && <Badge tone="ok">{formatSpeed(eth.speedGbps)} full duplex</Badge>}
        </div>
        <KV
          rows={[
            ['MAC', <Mono key="m">{macFor(serial)}</Mono>],
            ['Connected to', peer && peerEq ? `${peerEq.hostname} · ${peer.label}` : eth?.cableId ? 'cable plugged in, far end loose' : 'no cable'],
            ['IPv4', eff.address ? <Mono key="a">{`${eff.address}/${eff.prefix} (${prefixToMask(eff.prefix)})`}</Mono> : 'none'],
            ['Source', eff.source === 'dhcp' ? 'DHCP lease' : eff.source === 'apipa' ? 'link-local (no DHCP answer)' : eff.source === 'static' ? 'static' : 'n/a'],
            ['Gateway', eff.gateway || '—'],
            ['DNS', eff.dns || '—'],
            ['VLAN tag', ws.net.vlan === null ? 'untagged' : String(ws.net.vlan)],
          ]}
        />
        {eff.source === 'apipa' && <Callout tone="warn" className="mt-2">No DHCP server answered on this port's VLAN, so the laptop picked a 169.254.x.x address. Check which switch port and VLAN you are patched into, or set a static address.</Callout>}
        {ws.conflict && <Callout tone="crit" className="mt-2">IP address conflict: another device already uses {eff.address}.</Callout>}
      </div>

      <form onSubmit={apply} className="space-y-2 rounded-[5px] border border-border p-2.5" aria-label="IPv4 settings">
        <div className="flex items-center gap-3 text-[12px]">
          <label className="flex items-center gap-1.5">
            <input type="radio" name="mode" checked={form.mode === 'dhcp'} onChange={() => setForm({ ...form, mode: 'dhcp' })} className="accent-[#7cc33f]" /> Automatic (DHCP)
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="mode" checked={form.mode === 'static'} onChange={() => setForm({ ...form, mode: 'static' })} className="accent-[#7cc33f]" /> Manual
          </label>
          <label className="ml-auto flex items-center gap-1.5">
            <input type="checkbox" checked={form.adminUp} onChange={(e) => setForm({ ...form, adminUp: e.target.checked })} className="accent-[#7cc33f]" /> Interface up
          </label>
        </div>
        <div className={cn('grid grid-cols-2 gap-2 text-[12px]', form.mode === 'dhcp' && 'opacity-50')}>
          <label className="space-y-0.5">
            <span className="text-muted">Address</span>
            <Input aria-label="Address" value={form.address} disabled={form.mode === 'dhcp'} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="10.10.250.50" className="w-full" />
          </label>
          <label className="space-y-0.5">
            <span className="text-muted">Prefix length</span>
            <Input aria-label="Prefix length" value={String(form.prefix)} disabled={form.mode === 'dhcp'} onChange={(e) => setForm({ ...form, prefix: Number(e.target.value) || 0 })} className="w-full" inputMode="numeric" />
          </label>
          <label className="space-y-0.5">
            <span className="text-muted">Gateway</span>
            <Input aria-label="Gateway" value={form.gateway} disabled={form.mode === 'dhcp'} onChange={(e) => setForm({ ...form, gateway: e.target.value })} placeholder="10.10.0.1" className="w-full" />
          </label>
          <label className="space-y-0.5">
            <span className="text-muted">DNS server</span>
            <Input aria-label="DNS server" value={form.dns} disabled={form.mode === 'dhcp'} onChange={(e) => setForm({ ...form, dns: e.target.value })} placeholder="10.10.0.53" className="w-full" />
          </label>
        </div>
        <label className="flex items-center gap-2 text-[12px]">
          <span className="text-muted">802.1Q VLAN tag</span>
          <Input aria-label="VLAN tag" value={vlanText} onChange={(e) => setVlanText(e.target.value)} placeholder="untagged" className="w-24" inputMode="numeric" />
        </label>
        <Button type="submit" variant="primary">
          Apply
        </Button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function PingApp() {
  const [target, setTarget] = useState('10.10.1.11');
  const [result, setResult] = useState<ProbeResult | null>(null);
  const run = (e: FormEvent) => {
    e.preventDefault();
    const s = getSim();
    setResult(ping(s, target, 4, snapshotCache(s)));
  };
  return (
    <div className="space-y-2">
      <form onSubmit={run} className="flex gap-2">
        <Input aria-label="Ping target" value={target} onChange={(e) => setTarget(e.target.value)} className="flex-1 font-mono" placeholder="IP or hostname, e.g. dh1-r01-n01-bmc" />
        <Button type="submit" variant="primary">
          <Play /> Ping
        </Button>
      </form>
      <p className="text-[11.5px] text-subtle">
        DNS names: <Mono>&lt;host&gt;-bmc</Mono> for BMCs, <Mono>&lt;host&gt;</Mono> for the host OS, switch hostnames for their management ports.
      </p>
      {result && <Output lines={result.lines} ok={result.ok} />}
      <Why result={result} />
    </div>
  );
}

// ---------------------------------------------------------------------------
export function SshApp() {
  const [host, setHost] = useState('10.10.1.11');
  const [profile, setProfile] = useState<CredentialProfile>('bmc-admin');
  const [history, setHistory] = useState<{ host: string; result: ProbeResult }[]>([]);
  const connect = (e: FormEvent) => {
    e.preventDefault();
    const s = getSim();
    const result = sshConnect(s, host, profile, snapshotCache(s));
    setHistory((h) => [{ host, result }, ...h].slice(0, 5));
  };
  const last = history[0]?.result ?? null;
  return (
    <div className="space-y-2">
      <form onSubmit={connect} className="grid grid-cols-[1fr_auto] gap-2">
        <Input aria-label="SSH host" value={host} onChange={(e) => setHost(e.target.value)} className="font-mono" placeholder="host or IP" />
        <Button type="submit" variant="primary">
          <Terminal /> Connect
        </Button>
        <label className="col-span-2 flex items-center gap-2 text-[12px]">
          <KeyRound className="size-3.5 text-muted" />
          <span className="text-muted">Credential</span>
          <Select aria-label="Credential profile" value={profile} onChange={(e) => setProfile(e.target.value as CredentialProfile)} className="flex-1">
            {(Object.keys(CREDENTIALS) as CredentialProfile[]).map((k) => (
              <option key={k} value={k}>
                {CREDENTIALS[k].user}: {CREDENTIALS[k].label}
              </option>
            ))}
          </Select>
        </label>
      </form>
      <p className="text-[11.5px] text-subtle">Lab credentials come from the simulated vault, so no real passwords are involved. The interactive shell arrives with the Phase 3 terminal.</p>
      {last && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[12px]">
            <Badge tone={last.ok ? 'ok' : 'crit'}>{last.ok ? 'Connected' : 'Failed'}</Badge>
            <Mono className="text-muted">ssh {CREDENTIALS[profile].user}@{history[0].host}</Mono>
          </div>
          <Output lines={last.lines} ok={last.ok} />
        </div>
      )}
      <Why result={last} />
      {history.length > 1 && (
        <ul className="space-y-0.5 text-[11px] text-subtle">
          {history.slice(1).map((h, i) => (
            <li key={i}>
              {h.result.ok ? '✓' : '✗'} {h.host}: {h.result.lines[0]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function BrowserApp() {
  const [url, setUrl] = useState('https://10.10.1.11');
  const [result, setResult] = useState<ProbeResult | null>(null);
  const go = (e?: FormEvent) => {
    e?.preventDefault();
    const s = getSim();
    setResult(httpsGet(s, url, snapshotCache(s)));
  };
  return (
    <div className="space-y-2">
      <form onSubmit={go} className="flex gap-2">
        <div className="relative flex-1">
          <Globe className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-subtle" />
          <Input aria-label="Address bar" value={url} onChange={(e) => setUrl(e.target.value)} className="w-full pl-7 font-mono" />
        </div>
        <Button type="submit" variant="primary">
          Go
        </Button>
      </form>
      {result &&
        (result.ok && result.endpoint ? (
          <BmcWebUi equipmentId={result.endpoint.equipmentId} address={result.endpoint.ip} onRefresh={() => go()} />
        ) : (
          <div className="rounded-[5px] border border-border bg-surface-2 p-6 text-center">
            <CircleAlert className="mx-auto mb-2 size-6 text-subtle" />
            <div className="text-[13px] font-medium">This site can't be reached</div>
            <Mono className="text-muted">{result.lines[0]}</Mono>
          </div>
        ))}
      <Why result={result} />
    </div>
  );
}

// ---------------------------------------------------------------------------
export function ConsoleApp() {
  const s = useSim((st) => st);
  const consoleId = s.workstation.consoleEquipmentId;
  const reason = s.workstation.consoleReason;
  const screen = useMemo(() => (consoleId ? consoleScreen(s, consoleId) : null), [s, consoleId]);
  const host = consoleId ? s.equipment[consoleId] : undefined;
  if (!consoleId || !screen) {
    return (
      <Callout tone="info" title="No serial console attached">
        {reason ?? 'Connect a serial console cable (RJ45 rollover → USB-A) from a laptop USB-A port to the RJ45 console port of a server or switch. The console works without network or BMC access.'}
      </Callout>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[12px]">
        <Badge tone="ok">/dev/ttyUSB0</Badge>
        <span className="text-muted">115200 8N1 →</span>
        <Mono>{host?.hostname}</Mono>
        <Badge tone="muted" className="ml-auto">
          {screen.status}
        </Badge>
      </div>
      <pre className="h-[340px] overflow-auto rounded-[4px] border border-border bg-black p-2.5 font-mono text-[11.5px] leading-relaxed text-[#b8f0a8]" data-testid="serial-console">
        {screen.lines.length ? screen.lines.join('\n') : `(${screen.status.toLowerCase()})`}
      </pre>
    </div>
  );
}
