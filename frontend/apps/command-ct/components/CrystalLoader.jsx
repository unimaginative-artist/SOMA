import React from 'react';

const CrystalLoader = ({ size = 'md' }) => {
  const scales = {
    xs: 'scale-[0.1]',
    sm: 'scale-[0.2]',
    md: 'scale-[0.5]',
    lg: 'scale-100'
  };

  const heights = {
    xs: 'h-4',
    sm: 'h-8',
    md: 'h-24',
    lg: 'h-48'
  };

  return (
    <div className={`crystal-container ${scales[size]} ${heights[size]} overflow-visible`}>
      <div className="crystal-loader">
        <div className="crystal"></div>
        <div className="crystal"></div>
        <div className="crystal"></div>
        <div className="crystal"></div>
        <div className="crystal"></div>
        <div className="crystal"></div>
      </div>
    </div>
  );
};

export default CrystalLoader;
