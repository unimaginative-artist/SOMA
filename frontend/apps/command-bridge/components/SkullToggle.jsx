import React from 'react';
import './SkullToggle.css';

const SkullToggle = ({ isLocked, onToggle }) => {
    return (
        <div className="skull-toggle-wrapper">
            <div className="toggle">
                <input
                    type="checkbox"
                    id="btn"
                    checked={!isLocked}
                    onChange={(e) => onToggle(!e.target.checked)}
                />
                <label htmlFor="btn">
                    <span className="thumb">
                        <div className="cranium"></div>
                        <div className="mouth"></div>
                    </span>
                    <span className="arm-wrapper">
                        <span className="arm">
                            <span className="bone"></span>
                            <span className="bone"></span>
                            <span className="hand">
                                <span className="bone"></span>
                                <span className="bone"></span>
                                <span className="bone"></span>
                                <span className="bone"></span>
                            </span>
                            <span className="big"></span>
                        </span>
                    </span>
                </label>
            </div>
        </div>
    );
};

export default SkullToggle;
