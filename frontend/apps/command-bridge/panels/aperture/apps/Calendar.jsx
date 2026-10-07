import React, { useEffect, useState } from 'react';
import { CalendarDays, Clock, Plus, Trash2, ChevronLeft, ChevronRight, Filter } from 'lucide-react';
import somaBackend from '../../../somaBackend';

export default function CalendarApp({ workspace }) {
  const [events, setEvents] = useState([]);
  const [title, setTitle] = useState('');
  const [startsAt, setStartsAt] = useState(() => new Date(Date.now() + 3600000).toISOString().slice(0, 16));
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(null);

  const load = async () => {
    const suffix = workspace?.id ? `?workspaceId=${encodeURIComponent(workspace.id)}` : '';
    const response = await somaBackend.fetch(`/api/aperture/calendar${suffix}`);
    setEvents(response.events || []);
  };
  useEffect(() => { load().catch(() => setEvents([])); }, [workspace?.id]);

  const add = async event => {
    event.preventDefault();
    if (!title.trim()) return;
    await somaBackend.fetch('/api/aperture/calendar', {
      method: 'POST',
      body: JSON.stringify({ title: title.trim(), startsAt, workspaceId: workspace?.id || null, workspaceName: workspace?.name || 'Personal' })
    });
    setTitle('');
    await load();
  };
  const remove = async id => {
    await somaBackend.fetch(`/api/aperture/calendar/${id}`, { method: 'DELETE' });
    await load();
  };

  const prevMonth = () => { setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1)); setSelectedDay(null); };
  const nextMonth = () => { setCurrentDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1)); setSelectedDay(null); };
  const resetToday = () => { const now = new Date(); setCurrentDate(now); setSelectedDay(now.getDate()); };

  const firstDay = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay();
  const days = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate();

  // Find days in current month that have events
  const datedDays = new Set(
    events
      .filter(item => {
        const d = new Date(item.startsAt);
        return d.getFullYear() === currentDate.getFullYear() && d.getMonth() === currentDate.getMonth();
      })
      .map(item => new Date(item.startsAt).getDate())
  );

  const today = new Date();
  const isCurrentMonthYear = today.getFullYear() === currentDate.getFullYear() && today.getMonth() === currentDate.getMonth();
  const todayDate = today.getDate();

  const handleSelectDay = (dayNum) => {
    if (selectedDay === dayNum) {
      setSelectedDay(null);
    } else {
      setSelectedDay(dayNum);
      const d = new Date(currentDate.getFullYear(), currentDate.getMonth(), dayNum, 12, 0);
      setStartsAt(d.toISOString().slice(0, 16));
    }
  };

  const filteredEvents = selectedDay == null
    ? events
    : events.filter(e => {
        const d = new Date(e.startsAt);
        return d.getFullYear() === currentDate.getFullYear() &&
               d.getMonth() === currentDate.getMonth() &&
               d.getDate() === selectedDay;
      });

  return (
    <div className="ap-calendar-app">
      <section>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CalendarDays size={18} />
            <strong>{currentDate.toLocaleDateString([], { month: 'long', year: 'numeric' })}</strong>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button onClick={prevMonth} className="quiet" title="Previous Month" style={{ padding: '3px 6px', background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '4px', cursor: 'pointer', color: '#fff' }}><ChevronLeft size={14} /></button>
            <button onClick={resetToday} className="quiet" style={{ padding: '3px 8px', fontSize: '10px', background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '4px', cursor: 'pointer', color: '#4de8c2' }}>Today</button>
            <button onClick={nextMonth} className="quiet" title="Next Month" style={{ padding: '3px 6px', background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '4px', cursor: 'pointer', color: '#fff' }}><ChevronRight size={14} /></button>
          </div>
        </header>
        <div className="ap-calendar-grid">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => <b key={day}>{day}</b>)}
          {Array.from({ length: firstDay }, (_, index) => <i key={`blank-${index}`} />)}
          {Array.from({ length: days }, (_, index) => {
            const dayNum = index + 1;
            const hasEv = datedDays.has(dayNum);
            const isSel = selectedDay === dayNum;
            const isTod = isCurrentMonthYear && todayDate === dayNum;
            return (
              <span
                key={dayNum}
                onClick={() => handleSelectDay(dayNum)}
                className={`${hasEv ? 'has-event' : ''} ${isSel ? 'selected' : ''}`}
                style={{
                  cursor: 'pointer',
                  borderRadius: '6px',
                  background: isSel ? 'rgba(78,228,188,0.25)' : (isTod ? 'rgba(255,255,255,0.1)' : undefined),
                  outline: isSel ? '1px solid #4de8c2' : (isTod ? '1px solid rgba(255,255,255,0.2)' : undefined),
                  color: isSel ? '#4de8c2' : undefined,
                  fontWeight: isSel || isTod ? 700 : undefined
                }}
                title={`Day ${dayNum} — click to filter / schedule`}
              >
                {dayNum}
              </span>
            );
          })}
        </div>
      </section>
      <aside>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <h3>{workspace?.name || 'Personal'} Schedule</h3>
          {selectedDay != null && (
            <button
              onClick={() => setSelectedDay(null)}
              style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', background: 'rgba(78,228,188,0.15)', color: '#4de8c2', border: 'none', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer' }}
            >
              <Filter size={10} /> Day {selectedDay} (Clear)
            </button>
          )}
        </div>
        <form onSubmit={add}>
          <input required value={title} onChange={event => setTitle(event.target.value)} placeholder="Event title" />
          <input type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} required />
          <button><Plus size={14} /> Add event</button>
        </form>
        <div className="ap-events">
          {filteredEvents.map(item => (
            <article key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span><Clock size={11} />{new Date(item.startsAt).toLocaleString()}</span>
              </div>
              <button onClick={() => remove(item.id)}><Trash2 size={13} /></button>
            </article>
          ))}
          {!filteredEvents.length && (
            <p>{selectedDay != null ? `No scheduled events on day ${selectedDay}.` : 'No scheduled events in this workspace.'}</p>
          )}
        </div>
      </aside>
    </div>
  );
}
