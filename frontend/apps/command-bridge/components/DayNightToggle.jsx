import React from 'react';
import './DayNightToggle.css';

const DayNightToggle = ({ isNight, onToggle }) => {
    return (
        <div className="day-night-toggle-wrapper">
            <label className="switch">
                <input
                    type="checkbox"
                    checked={isNight}
                    onChange={(e) => onToggle(e.target.checked)}
                />
                <span className="slider round">
                    <div className="sun-moon">
                        <svg className="moon-dot moon-dot-1" viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r="50" />
                        </svg>
                        <svg className="moon-dot moon-dot-2" viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r="50" />
                        </svg>
                        <svg className="moon-dot moon-dot-3" viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r="50" />
                        </svg>
                    </div>
                    <svg className="light-ray light-ray-1" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="50" />
                    </svg>
                    <svg className="light-ray light-ray-2" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="50" />
                    </svg>
                    <svg className="light-ray light-ray-3" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="50" />
                    </svg>

                    <div className="clouds">
                        <svg className="cloud-dark cloud-1" viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r="50" />
                        </svg>
                        <svg className="cloud-dark cloud-2" viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r="50" />
                        </svg>
                        <svg className="cloud-dark cloud-3" viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r="50" />
                        </svg>
                        <svg className="cloud-light cloud-4" viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r="50" />
                        </svg>
                        <svg className="cloud-light cloud-5" viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r="50" />
                        </svg>
                        <svg className="cloud-light cloud-6" viewBox="0 0 100 100">
                            <circle cx="50" cy="50" r="50" />
                        </svg>
                    </div>

                    <div className="stars">
                        <svg className="star star-1" viewBox="0 0 20 20">
                            <path d="M10 0 L13 7 L20 10 L13 13 L10 20 L7 13 L0 10 L7 7 Z" />
                        </svg>
                        <svg className="star star-2" viewBox="0 0 20 20">
                            <path d="M10 0 L13 7 L20 10 L13 13 L10 20 L7 13 L0 10 L7 7 Z" />
                        </svg>
                        <svg className="star star-3" viewBox="0 0 20 20">
                            <path d="M10 0 L13 7 L20 10 L13 13 L10 20 L7 13 L0 10 L7 7 Z" />
                        </svg>
                        <svg className="star star-4" viewBox="0 0 20 20">
                            <path d="M10 0 L13 7 L20 10 L13 13 L10 20 L7 13 L0 10 L7 7 Z" />
                        </svg>
                    </div>
                </span>
            </label>
        </div>
    );
};

export default DayNightToggle;
