import React, { useState } from 'react';
import { Image as ImageIcon, Palette, Shield, Sparkles } from 'lucide-react';

export default function SettingsApp({ settings, onSettingsUpdate }) {
  const [customUrl, setCustomUrl] = useState(settings.wallpaperUrl || '');
  const permissions = settings.permissions || {};
  const updatePermission = key => onSettingsUpdate({ permissions: { [key]: !permissions[key] } });

  const uploadWallpaper = event => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onSettingsUpdate({ wallpaper: 'custom', wallpaperUrl: reader.result });
    reader.readAsDataURL(file);
  };

  return (
    <div className="ap-settings-app">
      <section>
        <h2><Palette size={16} /> Appearance</h2>
        <div className="ap-option-grid">
          {[['daylight', 'Daylight Glass'], ['graphite', 'Graphite'], ['slate', 'Slate']].map(([id, name]) => (
            <button key={id} className={settings.theme === id ? 'selected' : ''} onClick={() => onSettingsUpdate({ theme: id })}><strong>{name}</strong><span>{id === 'daylight' ? 'Bright spatial shell' : 'Quiet contrast shell'}</span></button>
          ))}
        </div>
      </section>
      <section>
        <h2><ImageIcon size={16} /> Wallpaper</h2>
        <div className="ap-option-grid wallpaper">
          {[['alpine', 'Alpine Morning'], ['mist', 'Ambient Mist'], ['graphite', 'Graphite Calm']].map(([id, name]) => (
            <button key={id} className={settings.wallpaper === id ? 'selected' : ''} onClick={() => onSettingsUpdate({ wallpaper: id, wallpaperUrl: '' })}><strong>{name}</strong></button>
          ))}
        </div>
        <div className="ap-custom-wallpaper">
          <input value={customUrl} onChange={event => setCustomUrl(event.target.value)} placeholder="https:// image URL" />
          <button onClick={() => customUrl.trim() && onSettingsUpdate({ wallpaper: 'custom', wallpaperUrl: customUrl.trim() })}>Apply URL</button>
          <label>Upload<input type="file" accept="image/*" onChange={uploadWallpaper} /></label>
        </div>
      </section>
      <section>
        <h2><Sparkles size={16} /> Aperture Autonomy</h2>
        <div className="ap-autonomy">
          <input type="range" min="1" max="3" value={settings.autonomyLevel} onChange={event => onSettingsUpdate({ autonomyLevel: Number(event.target.value) })} />
          <strong>{['Observe', 'Assisted', 'Autonomous'][settings.autonomyLevel - 1]}</strong>
          <p>This controls tool use initiated within Aperture. It does not silently alter global SOMA policy.</p>
        </div>
      </section>
      <section>
        <h2><Shield size={16} /> Enforced Aperture Gates</h2>
        <div className="ap-gates">
          {[
            ['fileRead', 'Read workspace files', 'File preview access in Files'],
            ['networkAccess', 'Research the web', 'Portal fetch and web search'],
            ['memoryWrite', 'Save to memory', 'Portal memory capture'],
            ['somaReasoning', 'Ask SOMA', 'Summaries and task extraction']
          ].map(([key, title, detail]) => (
            <button key={key} onClick={() => updatePermission(key)}><div><strong>{title}</strong><span>{detail}</span></div><i className={permissions[key] ? 'enabled' : ''} /></button>
          ))}
        </div>
      </section>
    </div>
  );
}
