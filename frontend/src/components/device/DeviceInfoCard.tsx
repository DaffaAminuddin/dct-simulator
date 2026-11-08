/**
 * Device information sheet (hostname, model, PN, SN, asset tag, location,
 * BMC / data addresses, switch ports, firmware) with copy buttons, shared by
 * Rack Explorer, the data hall and work orders.
 */
import { Check, Copy } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { deviceInfo, type NetIdentity } from '@/simulation/inventory/DeviceInfo';
import { useSim } from '@/stores/simulationStore';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/utils/cn';
import { formatSpeed, PORT_STATE_TEXT, portTone } from '@/utils/format';

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        const ok = () => {
          setDone(true);
          useUiStore.getState().notify({ tone: 'ok', title: `${label} copied`, detail: value });
          window.setTimeout(() => setDone(false), 1200);
        };
        if (navigator.clipboard?.writeText) navigator.clipboard.writeText(value).then(ok, ok);
        else ok();
      }}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-subtle hover:bg-surface-3 hover:text-fg"
    >
      {done ? <Check className="size-3.5 text-ok-ink" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/** One label / value row with an optional copy button. */
export function Field({ label, value, mono = true, copy = true, children }: { label: string; value?: string; mono?: boolean; copy?: boolean; children?: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-2 text-[12.5px]">
      <span className="w-[92px] shrink-0 text-muted">{label}</span>
      <span className={cn('min-w-0 flex-1 truncate', mono && 'font-mono text-[12px]')} title={value}>
        {children ?? value ?? <span className="text-subtle">—</span>}
      </span>
      {copy && value && <CopyButton value={value} label={label} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-subtle uppercase">{title}</div>
      <div className="divide-y divide-border/60">{children}</div>
    </div>
  );
}

function NetRow({ n }: { n: NetIdentity }) {
  const ip = n.ip ? `${n.ip}/${n.prefix}` : undefined;
  return (
    <div className="space-y-0.5 py-1.5">
      <div className="flex items-center gap-2 text-[12.5px]">
        <span className="min-w-0 flex-1 truncate">
          <span className="font-mono text-[12px] text-fg">{n.iface ?? n.label}</span>
          {n.iface && <span className="text-[11px] text-subtle"> · {n.label}</span>}
        </span>
        <Badge tone={portTone(n.state)}>
          {PORT_STATE_TEXT[n.state]}
          {n.speedGbps > 0 ? ` ${formatSpeed(n.speedGbps)}` : ''}
        </Badge>
      </div>
      {ip && <Field label="IP" value={n.ip}>{ip}</Field>}
      <Field label={n.address.length > 17 ? 'GUID / LL addr' : 'MAC'} value={n.address} />
      <Field label="Switch port" value={n.peer} copy={false} mono={false} />
    </div>
  );
}

export function DeviceInfoCard({ equipmentId, compact = false, className }: { equipmentId: string; compact?: boolean; className?: string }) {
  const s = useSim((st) => st);
  const eq = s.equipment[equipmentId];
  // Derive outside the store selector: a fresh object per call would re-render forever.
  const info = useMemo(() => (eq ? deviceInfo(s, eq) : null), [s, eq]);
  if (!info) return null;
  const m = info.management;
  return (
    <div className={cn('space-y-3', className)} data-testid="device-info">
      <Section title="Identity">
        <Field label="Hostname" value={info.hostname} />
        <Field label="Model" value={info.model} mono={false} />
        <Field label="Part number" value={info.partNumber} />
        <Field label="Serial (SN)" value={info.serial} />
        <Field label="Asset tag" value={info.assetTag} />
        <Field label="Location" value={info.location} mono={false} />
      </Section>
      {m && (
        <Section title={info.kind === 'switch' ? 'Management port' : 'BMC (out-of-band)'}>
          <Field label="IP address" value={m.ip}>
            {m.ip ? `${m.ip}/${m.prefix}` : undefined}
          </Field>
          <Field label="Gateway" value={m.gateway} />
          <Field label="MAC" value={m.address} />
          <Field label="Switch port" value={m.peer} copy={false} mono={false} />
          <Field label="Link" copy={false} mono={false}>
            <Badge tone={portTone(m.state)}>
              {PORT_STATE_TEXT[m.state]}
              {m.speedGbps > 0 ? ` ${formatSpeed(m.speedGbps)}` : ''}
            </Badge>
          </Field>
          {info.sshHint && <Field label="Access" value={info.sshHint} />}
        </Section>
      )}
      {info.network.length > 0 && (
        <Section title="Data and fabric interfaces">
          {(compact ? info.network.filter((n) => n.ip) : info.network).map((n) => (
            <NetRow key={n.portId} n={n} />
          ))}
          {compact && info.network.some((n) => !n.ip) && <div className="py-1.5 text-[11.5px] text-subtle">+{info.network.filter((n) => !n.ip).length} fabric / secondary ports (see Rack Explorer)</div>}
        </Section>
      )}
      {!compact && info.firmware && (
        <Section title="Software">
          <Field label="OS" value={info.os} mono={false} copy={false} />
          <Field label="BIOS" value={info.firmware.bios} copy={false} />
          <Field label={info.kind === 'switch' ? 'Firmware' : 'BMC firmware'} value={info.firmware.bmc} copy={false} />
        </Section>
      )}
    </div>
  );
}
