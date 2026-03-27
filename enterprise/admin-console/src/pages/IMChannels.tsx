import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Users, Settings, CheckCircle, XCircle, AlertCircle, ChevronRight } from 'lucide-react';
import { Card, Badge, Button, PageHeader, StatCard } from '../components/ui';
import { api } from '../api/client';
import { IM_ICONS } from '../components/IMIcons';

interface IMChannel {
  id: string;
  label: string;
  enterprise: boolean;
  status: 'connected' | 'configured' | 'not_connected';
  connectedEmployees: number;
  gatewayInfo: string;
}

function StatusBadge({ status }: { status: IMChannel['status'] }) {
  if (status === 'connected') return <Badge color="success" dot>Connected</Badge>;
  if (status === 'configured') return <Badge color="warning" dot>Configured</Badge>;
  return <Badge color="default">Not connected</Badge>;
}

function StatusIcon({ status }: { status: IMChannel['status'] }) {
  if (status === 'connected') return <CheckCircle size={18} className="text-success" />;
  if (status === 'configured') return <AlertCircle size={18} className="text-warning" />;
  return <XCircle size={18} className="text-text-muted" />;
}

export default function IMChannels() {
  const { data: channels = [], isLoading, refetch, isFetching } = useQuery<IMChannel[]>({
    queryKey: ['im-channels'],
    queryFn: () => api.get('/admin/im-channels'),
    refetchInterval: 30_000,
  });

  const connected = channels.filter(c => c.status === 'connected');
  const enterprise = channels.filter(c => c.enterprise);

  return (
    <div>
      <PageHeader
        title="IM Channels"
        description="Manage Gateway IM bot connections and monitor employee pairing status"
        actions={
          <Button variant="default" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} /> Refresh
          </Button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-6">
        <StatCard title="Connected" value={connected.length} subtitle={`of ${enterprise.length} enterprise channels`} icon={<CheckCircle size={22} />} color="success" />
        <StatCard title="Paired Employees" value={channels.reduce((s, c) => s + c.connectedEmployees, 0)} subtitle="across all channels" icon={<Users size={22} />} color="primary" />
        <StatCard title="Enterprise Channels" value={enterprise.length} subtitle="Telegram, Slack, Teams..." icon={<Settings size={22} />} color="info" />
        <StatCard title="Personal (Disabled)" value={channels.filter(c => !c.enterprise).length} subtitle="WhatsApp, WeChat" icon={<XCircle size={22} />} color="info" />
      </div>

      {/* Channel list */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Enterprise channels */}
        <Card>
          <h3 className="text-sm font-semibold text-text-primary mb-4 flex items-center gap-2">
            <CheckCircle size={16} className="text-success" /> Enterprise Channels
          </h3>
          <div className="space-y-3">
            {isLoading ? (
              <div className="py-8 text-center text-text-muted text-sm">Loading...</div>
            ) : (
              channels.filter(c => c.enterprise).map(ch => {
                const Icon = IM_ICONS[ch.id];
                return (
                  <div key={ch.id} className={`rounded-xl border px-4 py-3 flex items-center gap-3 transition-colors ${
                    ch.status === 'connected' ? 'border-success/20 bg-success/5'
                    : ch.status === 'configured' ? 'border-warning/20 bg-warning/5'
                    : 'border-dark-border/40 bg-dark-bg'
                  }`}>
                    <div className="flex-shrink-0">
                      {Icon ? <Icon size={28} /> : <div className="w-7 h-7 rounded-full bg-dark-hover" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-text-primary">{ch.label}</span>
                        <StatusBadge status={ch.status} />
                      </div>
                      {ch.status === 'connected' && (
                        <p className="text-xs text-text-muted">
                          {ch.connectedEmployees} employee{ch.connectedEmployees !== 1 ? 's' : ''} paired
                        </p>
                      )}
                      {ch.status === 'not_connected' && (
                        <p className="text-xs text-text-muted">Bot not configured in Gateway</p>
                      )}
                      {ch.gatewayInfo && (
                        <p className="text-[10px] text-text-muted font-mono mt-0.5 truncate">{ch.gatewayInfo}</p>
                      )}
                    </div>
                    <StatusIcon status={ch.status} />
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {/* Right panel: How to connect + personal channels */}
        <div className="space-y-4">
          {/* How to add a channel */}
          <Card>
            <h3 className="text-sm font-semibold text-text-primary mb-3 flex items-center gap-2">
              <Settings size={16} className="text-primary" /> How to Connect a New Channel
            </h3>
            <div className="space-y-3 text-xs text-text-secondary">
              {[
                { step: '1', label: 'Create a bot', detail: 'Telegram: @BotFather → /newbot · Slack: api.slack.com/apps · Teams: Azure Portal' },
                { step: '2', label: 'Get the token', detail: 'Copy the bot token / app credentials from the platform dashboard' },
                { step: '3', label: 'Add to Gateway', detail: 'SSH to EC2 → openclaw channels add --channel <name> --token <token>' },
                { step: '4', label: 'Restart Gateway', detail: 'sudo systemctl restart openclaw-gateway' },
                { step: '5', label: 'Verify here', detail: 'Refresh this page — status should show Connected' },
              ].map(s => (
                <div key={s.step} className="flex gap-3">
                  <div className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center">{s.step}</div>
                  <div>
                    <p className="font-medium text-text-primary">{s.label}</p>
                    <p className="text-text-muted">{s.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Personal channels (disabled) */}
          <Card>
            <h3 className="text-sm font-semibold text-text-muted mb-3 flex items-center gap-2">
              <XCircle size={16} /> Personal Channels (Not for enterprise)
            </h3>
            <div className="space-y-2">
              {channels.filter(c => !c.enterprise).map(ch => {
                const Icon = IM_ICONS[ch.id];
                return (
                  <div key={ch.id} className="flex items-center gap-3 rounded-lg bg-dark-bg border border-dark-border/30 px-3 py-2 opacity-50">
                    {Icon ? <Icon size={22} /> : null}
                    <span className="text-sm text-text-muted">{ch.label}</span>
                    <span className="ml-auto text-[10px] text-text-muted">Personal messaging — not enterprise-grade</span>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Pairing policy note */}
          <div className="rounded-xl bg-info/5 border border-info/20 px-4 py-3 text-xs text-info flex items-start gap-2">
            <ChevronRight size={14} className="mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium mb-1">Auto-approve pairing is enabled</p>
              <p className="text-info/80">Employees can self-service connect their IM via Portal → Connect IM. No admin approval needed. You can revoke anytime in Bindings → IM User Mappings.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
