import React, { useState, useEffect } from 'react'
import { useStore } from '../store'
import { t } from '../i18n'

interface CheckItem {
  label: string
  status: 'checking' | 'ok' | 'warn' | 'fail'
  detail: string
}

interface Props {
  onClose: () => void
}

export function PreShowCheck({ onClose }: Props): React.JSX.Element {
  const { lang } = useStore()
  const [checks, setChecks] = useState<CheckItem[]>([])
  const [running, setRunning] = useState(true)

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      const s = useStore.getState()
      const results: CheckItem[] = []

      // 1. Audio file loaded
      results.push({
        label: t(lang, 'checkFile'),
        status: s.filePath ? 'ok' : 'warn',
        detail: s.filePath ? s.fileName ?? '' : t(lang, 'checkNoFile')
      })

      // 2. Setlist files exist
      if (s.setlist.length > 0) {
        const existResults = await Promise.all(
          s.setlist.map(item => window.api.fileExists(item.path).catch(() => false))
        )
        const missing = existResults.filter(e => !e).length
        results.push({
          label: t(lang, 'checkSetlist'),
          status: missing === 0 ? 'ok' : 'fail',
          detail: missing === 0 ? `${s.setlist.length} ${t(lang, 'checkSongsOk')}` : `${missing} ${t(lang, 'checkFilesMissing')}`
        })
      }

      // 3. LTC output
      results.push({
        label: 'LTC Output',
        status: s.ltcOutputDeviceId && s.ltcOutputDeviceId !== 'default' ? 'ok' : 'warn',
        detail: s.ltcOutputDeviceId === 'default' ? 'Muted' : s.ltcOutputDeviceId ? 'OK' : 'Not set'
      })

      // 4. MTC MIDI port
      results.push({
        label: 'MTC Output',
        status: s.midiConnected ? 'ok' : 'warn',
        detail: s.midiConnected ? 'Connected' : 'No port selected'
      })

      // 5. Art-Net
      if (s.artnetEnabled) {
        results.push({
          label: 'Art-Net',
          status: 'ok',
          detail: `→ ${s.artnetTargetIp}`
        })
      }

      // 6. OSC
      if (s.oscEnabled) {
        results.push({
          label: 'OSC',
          status: 'ok',
          detail: `→ ${s.oscTargetIp}:${s.oscTargetPort}`
        })
      }

      // 7. MIDI Clock
      if (s.midiClockEnabled) {
        const bpm = s.midiClockSource === 'manual' ? s.midiClockManualBpm
          : s.midiClockSource === 'tapped' ? (s.tappedBpm ?? 0) : (s.detectedBpm ?? 0)
        results.push({
          label: 'MIDI Clock',
          status: bpm > 0 ? 'ok' : 'warn',
          detail: bpm > 0 ? `${bpm} BPM` : 'No BPM source'
        })
      }

      if (!cancelled) {
        setChecks(results)
        setRunning(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [lang])

  const allOk = checks.every(c => c.status === 'ok')
  const hasFailure = checks.some(c => c.status === 'fail')

  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div className="shortcuts-dialog" style={{ minWidth: '360px' }} onClick={(e) => e.stopPropagation()}>
        <h3>{t(lang, 'preShowTitle')}</h3>
        {running ? (
          <div style={{ textAlign: 'center', padding: '20px', color: '#888' }}>Checking...</div>
        ) : (
          <>
            <table className="preshow-table">
              <tbody>
                {checks.map((c, i) => (
                  <tr key={i}>
                    <td className={`preshow-status preshow-status--${c.status}`}>
                      {c.status === 'ok' ? '✓' : c.status === 'warn' ? '—' : '✗'}
                    </td>
                    <td className="preshow-label">{c.label}</td>
                    <td className="preshow-detail">{c.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={`preshow-verdict ${allOk ? 'preshow-verdict--ok' : hasFailure ? 'preshow-verdict--fail' : 'preshow-verdict--warn'}`}>
              {allOk ? t(lang, 'preShowAllGood') : hasFailure ? t(lang, 'preShowIssues') : t(lang, 'preShowWarnings')}
            </div>
          </>
        )}
        <button className="btn-sm" onClick={onClose} style={{ marginTop: '12px' }}>
          {t(lang, 'shortcutsClose')}
        </button>
      </div>
    </div>
  )
}
