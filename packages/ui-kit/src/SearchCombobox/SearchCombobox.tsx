'use client';

import { useId } from 'react';
import type { FormEvent } from 'react';
import { SearchIcon } from '../icons/index.js';
import styles from './SearchCombobox.module.css';

export interface SearchComboboxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
}

export function SearchCombobox({
  value,
  onChange,
  onSubmit,
  placeholder = 'Mahsulot qidirish...',
}: SearchComboboxProps) {
  const inputId = useId();
  const isEmpty = value.trim() === '';

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isEmpty) {
      return;
    }
    onSubmit(value);
  };

  return (
    <form role="search" className={styles.form} onSubmit={handleSubmit}>
      <label htmlFor={inputId} className={styles.visuallyHidden}>
        Mahsulot qidirish
      </label>
      <SearchIcon size={18} className={styles.icon} />
      <input
        id={inputId}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={styles.input}
      />
      <button type="submit" disabled={isEmpty} className={styles.submit} aria-label="Qidirish">
        <SearchIcon size={16} />
      </button>
    </form>
  );
}
