import React, { useState, useEffect } from 'react';
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Tooltip } from 'recharts';
import { Award } from 'lucide-react';

const SkillProficiencyRadar = ({ isConnected }) => {
  const [skills, setSkills] = useState([]);
  const [hasData, setHasData] = useState(false);

  useEffect(() => {
    if (!isConnected) return;

    const fetchSkills = async () => {
      try {
        const res = await fetch('/api/skills/stats');
        if (res.ok) {
          const data = await res.json();

          // Map skillAcquisition stats to radar chart format
          if (data.success && data.stats) {
            const radarData = [
              { subject: 'Coding', A: data.stats.coding || 0, fullMark: 100 },
              { subject: 'Reasoning', A: data.stats.reasoning || 0, fullMark: 100 },
              { subject: 'Memory', A: data.stats.memory || 0, fullMark: 100 },
              { subject: 'Creativity', A: data.stats.creativity || 0, fullMark: 100 },
              { subject: 'Vision', A: data.stats.vision || 0, fullMark: 100 },
              { subject: 'Strategy', A: data.stats.strategy || 0, fullMark: 100 },
            ];
            setSkills(radarData);
            setHasData(data.stats.tracked || false);
          }
        }
      } catch (error) {
        console.warn('Failed to fetch skills:', error);
      }
    };

    fetchSkills();
    const interval = setInterval(fetchSkills, 10000); // Update every 10s
    return () => clearInterval(interval);
  }, [isConnected]);

  return (
    <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 shadow-lg h-[300px] flex flex-col">
      <h3 className="text-zinc-100 font-semibold text-sm mb-2 flex items-center">
        <Award className="w-4 h-4 mr-2 text-yellow-400" /> Skill Proficiency Matrix
      </h3>
      {!hasData ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-zinc-600 text-xs italic">
            <p>No skill proficiency data tracked yet.</p>
            <p className="text-[10px] mt-1 text-zinc-700">Skills will appear as SOMA learns.</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart cx="50%" cy="50%" outerRadius="70%" data={skills}>
              <PolarGrid stroke="#333" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: '#a1a1aa', fontSize: 10 }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
              <Radar name="SOMA" dataKey="A" stroke="#facc15" fill="#facc15" fillOpacity={0.2} />
              <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #333' }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default SkillProficiencyRadar;