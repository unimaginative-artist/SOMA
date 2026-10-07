import React from 'react';
import { Users, MapPin, Zap } from 'lucide-react';

export default function ThirdPlace() {
    return (
        <div style={{
            width: '100%', height: '100%', background: '#09090b',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            padding: '40px 24px', textAlign: 'center',
        }}>
            {/* Icon cluster */}
            <div style={{ position: 'relative', width: 80, height: 80, marginBottom: 28 }}>
                <div style={{ width: 80, height: 80, borderRadius: 20, background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Users size={32} color="#a78bfa" strokeWidth={1.5} />
                </div>
                <div style={{ position: 'absolute', bottom: -6, right: -6, width: 26, height: 26, borderRadius: 8, background: '#09090b', border: '1px solid rgba(167,139,250,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <MapPin size={13} color="#6366f1" />
                </div>
            </div>

            {/* Label */}
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 10 }}>
                Coming Soon
            </div>

            <h2 style={{ fontSize: 22, fontWeight: 700, color: '#e4e4e7', margin: '0 0 12px', lineHeight: 1.3 }}>
                Third Place
            </h2>

            <p style={{ fontSize: 14, color: '#52525b', maxWidth: 380, lineHeight: 1.7, margin: '0 0 32px' }}>
                A persistent social space where SOMA nodes share presence — zones, faces, and live chat across the Gray Matter Network.
                Building now.
            </p>

            {/* Feature previews */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 480 }}>
                {[
                    { icon: '🌆', label: 'Zones', desc: 'Food Court, Arcade, Café, and more' },
                    { icon: '🧑‍🤝‍🧑', label: 'Live Presence', desc: 'See who\'s online across nodes' },
                    { icon: '💬', label: 'Zone Chat', desc: 'Per-zone channel threads' },
                ].map(f => (
                    <div key={f.label} style={{
                        padding: '12px 16px', borderRadius: 10,
                        background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                        flex: '1 1 130px', textAlign: 'left',
                    }}>
                        <div style={{ fontSize: 18, marginBottom: 6 }}>{f.icon}</div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: '#a1a1aa', marginBottom: 3 }}>{f.label}</div>
                        <div style={{ fontSize: 11, color: '#3f3f46', lineHeight: 1.5 }}>{f.desc}</div>
                    </div>
                ))}
            </div>

            <div style={{ marginTop: 40, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', borderRadius: 100, background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.15)' }}>
                <Zap size={13} color="#818cf8" />
                <span style={{ fontSize: 12, color: '#818cf8', fontWeight: 500 }}>Requires Gray Matter Network — connect nodes in the GMN tab first</span>
            </div>
        </div>
    );
}
