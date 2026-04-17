import React, { useState, useEffect, useRef } from 'react'
import { showLog, ShowLogEntry } from '../utils/showLog'
import { useStore } from '../store'
import { t } from '../i18n'
import { toast } from './Toast'

export function ShowLogPanel(): React.JSX.Element {
  const { lang } = useStore()
  const [entries, setEntries] = useState<ShowLogEntry[]>(showLog.getEntries())
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsub = showLog.subscribe(() => {
      setEntries([...showLog.getEntries()])
    })
    return unsub
  }, [])

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [entries.length])

  const handleExport = async (): Promise<void> => {
    const csv = showLog.toCsv()
    const saved = await window.api.saveCsvDialog(csv, 'show-log.csv')
    if (saved) toast.success('Show log exported')
  }

  return (
    <div className="showlog-panel">
      <div className="showlog-header">
        <span className="showlog-title">{t(lang, 'showLogTitle')}</span>
        <span style={{ flex: 1 }} />
        <button className="btn-sm" onClick={handleExport} disabled={entries.length === 0}>CSV</button>
        <button className="btn-sm" onClick={() => showLog.clear()} disabled={entries.length === 0}>{t(lang, 'clearAll')}</button>
      </div>
      <div className="showlog-list" ref={listRef}>
        {entries.length === 0 ? (
          <div className="showlog-empty">{t(lang, 'showLogEmpty')}</div>
        ) : (
          entries.map((e, i) => (
            <div key={i} className={`showlog-entry showlog-entry--${e.event}`}>
              <span className="showlog-time">{e.time.slice(11, 19)}</span>
              <span className="showlog-event">{e.event}</span>
              <span className="showlog-detail">{e.detail}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
