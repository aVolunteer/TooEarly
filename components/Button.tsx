import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'danger' | 'secondary' | 'icon';
  large?: boolean;
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  large = false,
  className = '',
  ...props 
}) => {
  const baseStyle = "font-bold rounded-lg transition-transform active:scale-95 focus:outline-none focus:ring-4 focus:ring-offset-2 focus:ring-offset-gray-900";
  
  const sizeStyle = large ? "p-4 text-xl md:text-2xl" : "p-3 text-lg";
  
  let variantStyle = "";
  switch (variant) {
    case 'primary':
      variantStyle = "bg-yellow-400 text-black hover:bg-yellow-300 focus:ring-yellow-400";
      break;
    case 'danger':
      variantStyle = "bg-red-600 text-white hover:bg-red-500 focus:ring-red-600";
      break;
    case 'secondary':
      variantStyle = "bg-gray-700 text-white hover:bg-gray-600 focus:ring-gray-500";
      break;
    case 'icon':
      variantStyle = "p-2 bg-transparent hover:bg-gray-800 text-gray-300 rounded-full";
      break;
  }

  return (
    <button 
      className={`${baseStyle} ${variant !== 'icon' ? sizeStyle : ''} ${variantStyle} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};