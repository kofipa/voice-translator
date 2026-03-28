import { useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet } from 'react-native';

export default function TextInputMode({ onSend }) {
  const [text, setText] = useState('');

  function handleSend() {
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        placeholder="Type text to translate..."
        placeholderTextColor="#555"
        value={text}
        onChangeText={setText}
        multiline
        returnKeyType="send"
        onSubmitEditing={handleSend}
      />
      <TouchableOpacity style={styles.btn} onPress={handleSend}>
        <Text style={styles.btnText}>Translate</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8, marginTop: 8 },
  input: {
    backgroundColor: '#1e1e1e', borderRadius: 10, color: '#fff',
    padding: 14, fontSize: 15, minHeight: 80, textAlignVertical: 'top',
  },
  btn: { backgroundColor: '#4f9eff', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
