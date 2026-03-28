import { useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal,
  FlatList, StyleSheet, TextInput,
} from 'react-native';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'ru', label: 'Russian' },
  { code: 'ar', label: 'Arabic' },
  { code: 'zh', label: 'Chinese (Simplified)' },
  { code: 'zh-TW', label: 'Chinese (Traditional)' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'hi', label: 'Hindi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'tr', label: 'Turkish' },
  { code: 'vi', label: 'Vietnamese' },
  { code: 'th', label: 'Thai' },
  { code: 'sw', label: 'Swahili' },
  { code: 'yo', label: 'Yoruba' },
  { code: 'ha', label: 'Hausa' },
  { code: 'am', label: 'Amharic' },
  { code: 'fa', label: 'Persian' },
  { code: 'ur', label: 'Urdu' },
  { code: 'id', label: 'Indonesian' },
  { code: 'ms', label: 'Malay' },
  { code: 'uk', label: 'Ukrainian' },
  { code: 'ro', label: 'Romanian' },
  { code: 'sv', label: 'Swedish' },
  { code: 'no', label: 'Norwegian' },
  { code: 'fi', label: 'Finnish' },
  { code: 'da', label: 'Danish' },
  { code: 'cs', label: 'Czech' },
  { code: 'hu', label: 'Hungarian' },
  { code: 'el', label: 'Greek' },
  { code: 'he', label: 'Hebrew' },
];

export default function LanguagePicker({ selected, onSelect }) {
  const [visible, setVisible] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = LANGUAGES.filter(l =>
    l.label.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      <TouchableOpacity style={styles.picker} onPress={() => setVisible(true)}>
        <Text style={styles.pickerLabel}>My language</Text>
        <Text style={styles.pickerValue}>{selected.label} ▾</Text>
      </TouchableOpacity>

      <Modal visible={visible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Select your language</Text>
            <TextInput
              style={styles.search}
              placeholder="Search..."
              placeholderTextColor="#555"
              value={search}
              onChangeText={setSearch}
            />
            <FlatList
              data={filtered}
              keyExtractor={item => item.code}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.option}
                  onPress={() => { onSelect(item); setVisible(false); setSearch(''); }}
                >
                  <Text style={[styles.optionText, item.code === selected.code && styles.optionTextSelected]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity style={styles.closeBtn} onPress={() => setVisible(false)}>
              <Text style={styles.closeBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  picker: {
    backgroundColor: '#1e1e1e', borderRadius: 10, padding: 14,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 12,
  },
  pickerLabel: { color: '#888', fontSize: 13 },
  pickerValue: { color: '#fff', fontSize: 15, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#1a1a1a', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '80%' },
  modalTitle: { color: '#fff', fontSize: 17, fontWeight: '700', marginBottom: 12 },
  search: { backgroundColor: '#2a2a2a', borderRadius: 8, color: '#fff', padding: 10, marginBottom: 10 },
  option: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: '#222' },
  optionText: { color: '#ccc', fontSize: 15 },
  optionTextSelected: { color: '#4f9eff', fontWeight: '700' },
  closeBtn: { marginTop: 12, alignItems: 'center', paddingVertical: 14 },
  closeBtnText: { color: '#e74c3c', fontSize: 16, fontWeight: '600' },
});
