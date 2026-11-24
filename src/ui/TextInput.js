import React, { useEffect, useState } from 'react';
import { Text, useInput } from 'ink';
export default function TextInput({ value = '', onChange, onSubmit, focus = true, mask }) {
  const [cursor, setCursor] = useState(value.length);
  useEffect(() => { if (focus) setCursor(value.length); }, [focus]);
  useEffect(() => setCursor(current => Math.min(current, value.length)), [value.length]);
  useInput((input, key) => {
    if (key.ctrl || key.meta || key.tab || key.escape || key.upArrow || key.downArrow) return;
    if (key.return) { onSubmit?.(value); return; }
    if (key.leftArrow) { setCursor(Math.max(0, cursor - 1)); return; }
    if (key.rightArrow) { setCursor(Math.min(value.length, cursor + 1)); return; }
    if (key.backspace || key.delete) {
      if (cursor > 0) { onChange(value.slice(0, cursor - 1) + value.slice(cursor)); setCursor(cursor - 1); }
      return;
    }
    const text = input.replace(/[\x00-\x1f\x7f]/g, '');
    if (text) { onChange(value.slice(0, cursor) + text + value.slice(cursor)); setCursor(cursor + text.length); }
  }, { isActive: focus });
  const display = mask ? mask.repeat(value.length) : value;
  return <Text>{display.slice(0, cursor)}{focus ? <Text inverse>{display[cursor] || ' '}</Text> : display[cursor]}{display.slice(cursor + 1)}</Text>;
}
