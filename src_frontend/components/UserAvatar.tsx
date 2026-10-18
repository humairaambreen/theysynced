'use client';

import React from 'react';
import { GradientAvatar } from '@outpacelabs/avatars';

interface UserAvatarProps {
  seed: string;
  avatarUrl?: string;
  size?: number;
  className?: string;
}

export const UserAvatar: React.FC<UserAvatarProps> = ({
  seed,
  avatarUrl,
  size = 32,
  className = '',
}) => {
  if (avatarUrl && avatarUrl.trim() !== '') {
    return (
      <img
        src={avatarUrl}
        alt={seed}
        style={{ width: `${size}px`, height: `${size}px` }}
        className={`rounded-full object-cover shadow-sm ${className}`}
      />
    );
  }

  return (
    <div
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`relative inline-flex items-center justify-center shrink-0 overflow-hidden rounded-full shadow-sm ${className}`}
    >
      <GradientAvatar seed={seed || 'user'} size={size} pattern="mesh" />
    </div>
  );
};
