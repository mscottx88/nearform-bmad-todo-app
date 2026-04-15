import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCreateTodo } from '../../api/todoApi';
import './TodoInput.css';

interface TodoInputProps {
  isOpen: boolean;
  onClose: () => void;
}

function generatePosition(): { positionX: number; positionY: number } {
  return {
    positionX: (Math.random() - 0.5) * 16,
    positionY: (Math.random() - 0.5) * 12,
  };
}

export function TodoInput({ isOpen, onClose }: TodoInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dissolving, setDissolving] = useState(false);
  const createTodo = useCreateTodo();

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  if (!isOpen && !dissolving) return null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'Enter') {
      const text = inputRef.current?.value.trim();
      if (!text) return;
      setDissolving(true);
      const pos = generatePosition();
      createTodo.mutate({ text, ...pos });
      setTimeout(() => {
        setDissolving(false);
        onClose();
      }, 100);
    }
  };

  return createPortal(
    <div className="todo-input-overlay">
      <input
        ref={inputRef}
        className={`todo-input ${dissolving ? 'todo-input--dissolving' : ''}`}
        type="text"
        placeholder="what's on your mind..."
        onKeyDown={handleKeyDown}
        onBlur={onClose}
      />
    </div>,
    document.body,
  );
}
