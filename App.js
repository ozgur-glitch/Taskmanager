import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  Alert,
  SafeAreaView,
  StatusBar,
  Platform,
  Share,
  ScrollView,
  Modal,
  Switch
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Native Modul-Einbindung mit Try-Catch Fallbacks für Expo Go / Spck Editor
let FileSystem = null;
let DocumentPicker = null;
let Notifications = null;

try {
  FileSystem = require('expo-file-system');
} catch (e) {
  console.log('expo-file-system ist in dieser Umgebung nicht verfügbar.');
}

try {
  DocumentPicker = require('expo-document-picker');
} catch (e) {
  console.log('expo-document-picker ist in dieser Umgebung nicht verfügbar.');
}

try {
  Notifications = require('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch (e) {
  console.log('expo-notifications ist in dieser Umgebung nicht verfügbar.');
}

const STORAGE_KEYS = {
  TASKS: '@taskmanager_tasks_v1',
  SETTINGS: '@taskmanager_settings_v1',
};

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [textInput, setTextInput] = useState('');
  const [category, setCategory] = useState('Allgemein');
  const [priority, setPriority] = useState('Mittel'); // Hoch, Mittel, Niedrig
  const [filter, setFilter] = useState('Alle'); // Alle, Offen, Erledigt
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);

  // Initiales Laden
  useEffect(() => {
    loadData();
    requestNotificationPermissions();
  }, []);

  // Automatisches Speichern bei Änderung der Tasks
  useEffect(() => {
    saveTasks(tasks);
  }, [tasks]);

  const requestNotificationPermissions = async () => {
    if (Notifications && Platform.OS !== 'web') {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') {
          await Notifications.requestPermissionsAsync();
        }
      } catch (err) {
        console.log('Fehler beim Anfordern von Benachrichtigungsrechten:', err);
      }
    }
  };

  const scheduleTaskNotification = async (taskTitle) => {
    if (Notifications && Platform.OS !== 'web') {
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Task Erstellt 📝',
            body: `Vergiss nicht: "${taskTitle}" abzuarbeiten!`,
          },
          trigger: null, // Sofort anzeigen als Bestätigung
        });
      } catch (err) {
        console.log('Benachrichtigungsfehler:', err);
      }
    }
  };

  const loadData = async () => {
    try {
      const storedTasks = await AsyncStorage.getItem(STORAGE_KEYS.TASKS);
      const storedSettings = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);

      if (storedTasks !== null) {
        setTasks(JSON.parse(storedTasks));
      }
      if (storedSettings !== null) {
        const settings = JSON.parse(storedSettings);
        setIsDarkMode(settings.isDarkMode ?? true);
      }
    } catch (e) {
      Alert.alert('Fehler', 'Daten konnten nicht geladen werden.');
    }
  };

  const saveTasks = async (newTasks) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(newTasks));
    } catch (e) {
      console.log('Fehler beim automatischen Speichern:', e);
    }
  };

  const toggleDarkMode = async (val) => {
    setIsDarkMode(val);
    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.SETTINGS,
        JSON.stringify({ isDarkMode: val })
      );
    } catch (e) {
      console.log('Fehler beim Speichern der Einstellungen:', e);
    }
  };

  const addTask = () => {
    if (textInput.trim() === '') {
      Alert.alert('Hinweis', 'Bitte gib eine Aufgabenbeschreibung ein.');
      return;
    }

    const newTask = {
      id: Date.now().toString(),
      title: textInput.trim(),
      category: category,
      priority: priority,
      completed: false,
      createdAt: new Date().toLocaleDateString('de-DE'),
    };

    setTasks([newTask, ...tasks]);
    setTextInput('');
    scheduleTaskNotification(newTask.title);
  };

  const toggleTask = (id) => {
    setTasks(
      tasks.map((task) =>
        task.id === id ? { ...task, completed: !task.completed } : task
      )
    );
  };

  const deleteTask = (id) => {
    Alert.alert('Löschen', 'Möchtest du diese Aufgabe wirklich löschen?', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: () => setTasks(tasks.filter((task) => task.id !== id)),
      },
    ]);
  };

  // --- ROBUSTER JSON BACKUP & WIEDERHERSTELLUNG ---
  const exportBackup = async () => {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const stores = await AsyncStorage.multiGet(allKeys);
      const backupData = {};

      stores.forEach(([key, value]) => {
        try {
          backupData[key] = JSON.parse(value);
        } catch {
          backupData[key] = value;
        }
      });

      const jsonString = JSON.stringify(backupData, null, 2);
      const fileName = `TaskManager_Backup_${Date.now()}.json`;

      if (Platform.OS === 'android' && FileSystem && FileSystem.StorageAccessFramework) {
        // Android SAF Export
        const permissions =
          await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (permissions.granted) {
          const uri = await FileSystem.StorageAccessFramework.createFileAsync(
            permissions.directoryUri,
            fileName,
            'application/json'
          );
          await FileSystem.writeAsStringAsync(uri, jsonString, {
            encoding: FileSystem.EncodingType.UTF8,
          });
          Alert.alert('Erfolg', 'Backup erfolgreich gespeichert!');
        }
      } else if (FileSystem && FileSystem.documentDirectory) {
        // iOS / Fallback Export
        const fileUri = `${FileSystem.documentDirectory}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, jsonString, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        Alert.alert('Backup Erstellt', `Gespeichert unter:\n${fileUri}`);
      } else {
        // Web / Fallback Share API
        await Share.share({
          message: jsonString,
          title: fileName,
        });
      }
    } catch (err) {
      Alert.alert('Export Fehler', 'Export konnte nicht abgeschlossen werden: ' + err.message);
    }
  };

  const importBackup = async () => {
    if (!DocumentPicker) {
      Alert.alert('Fehler', 'Document Picker ist in dieser Umgebung nicht verfügbar.');
      return;
    }

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const fileUri = result.assets[0].uri;
      let content = '';

      if (FileSystem) {
        content = await FileSystem.readAsStringAsync(fileUri, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      } else {
        Alert.alert('Fehler', 'Dateisystem-Zugriff nicht möglich.');
        return;
      }

      const parsedData = JSON.parse(content);

      // Validierung
      if (typeof parsedData !== 'object' || parsedData === null) {
        throw new Error('Ungültiges Backup-Format');
      }

      Alert.alert(
        'Wiederherstellung',
        'Möchtest du alle aktuellen Daten überschreiben? Dieser Vorgang kann nicht rückgängig gemacht werden.',
        [
          { text: 'Abbrechen', style: 'cancel' },
          {
            text: 'Überschreiben',
            style: 'destructive',
            onPress: async () => {
              for (const [key, value] of Object.entries(parsedData)) {
                const strValue = typeof value === 'string' ? value : JSON.stringify(value);
                await AsyncStorage.setItem(key, strValue);
              }
              await loadData();
              setSettingsModalVisible(false);
              Alert.alert('Erfolg', 'Daten erfolgreich wiederhergestellt!');
            },
          },
        ]
      );
    } catch (err) {
      Alert.alert('Import Fehler', 'Datei konnte nicht gelesen oder verarbeitet werden: ' + err.message);
    }
  };

  // Theme-Farben (Clean & Modern Slate Theme)
  const theme = isDarkMode
    ? {
        bg: '#0F172A',
        cardBg: '#1E293B',
        text: '#F8FAFC',
        textMuted: '#94A3B8',
        accent: '#6366F1',
        border: '#334155',
        priorityHigh: '#EF4444',
        priorityMed: '#F59E0B',
        priorityLow: '#10B981',
      }
    : {
        bg: '#F8FAFC',
        cardBg: '#FFFFFF',
        text: '#0F172A',
        textMuted: '#64748B',
        accent: '#4F46E5',
        border: '#E2E8F0',
        priorityHigh: '#EF4444',
        priorityMed: '#F59E0B',
        priorityLow: '#10B981',
      };

  const filteredTasks = tasks.filter((task) => {
    if (filter === 'Offen') return !task.completed;
    if (filter === 'Erledigt') return task.completed;
    return true;
  });

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.bg }]}>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />

      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.headerTitle, { color: theme.text }]}>Task Manager</Text>
          <Text style={[styles.headerSubtitle, { color: theme.textMuted }]}>
            {tasks.filter((t) => !t.completed).length} Aufgaben offen
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.iconButton, { backgroundColor: theme.cardBg, borderColor: theme.border }]}
          onPress={() => setSettingsModalVisible(true)}
        >
          <Text style={{ fontSize: 18 }}>⚙️</Text>
        </TouchableOpacity>
      </View>

      {/* Eingabe-Bereich */}
      <View style={[styles.inputCard, { backgroundColor: theme.cardBg, borderColor: theme.border }]}>
        <TextInput
          style={[styles.input, { color: theme.text, borderColor: theme.border }]}
          placeholder="Neue Aufgabe eingeben..."
          placeholderTextColor={theme.textMuted}
          value={textInput}
          onChangeText={setTextInput}
        />

        {/* Prioritätsauswahl */}
        <View style={styles.row}>
          <Text style={[styles.label, { color: theme.textMuted }]}>Priorität:</Text>
          {['Niedrig', 'Mittel', 'Hoch'].map((p) => (
            <TouchableOpacity
              key={p}
              style={[
                styles.badge,
                {
                  backgroundColor: priority === p ? theme.accent : 'transparent',
                  borderColor: theme.border,
                },
              ]}
              onPress={() => setPriority(p)}
            >
              <Text
                style={{
                  color: priority === p ? '#FFF' : theme.textMuted,
                  fontSize: 12,
                  fontWeight: '600',
                }}
              >
                {p}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.addButton, { backgroundColor: theme.accent }]}
          onPress={addTask}
        >
          <Text style={styles.addButtonText}>Aufgabe Hinzufügen</Text>
        </TouchableOpacity>
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterRow}>
        {['Alle', 'Offen', 'Erledigt'].map((f) => (
          <TouchableOpacity
            key={f}
            style={[
              styles.filterTab,
              filter === f && { borderBottomColor: theme.accent, borderBottomWidth: 2 },
            ]}
            onPress={() => setFilter(f)}
          >
            <Text
              style={{
                color: filter === f ? theme.accent : theme.textMuted,
                fontWeight: filter === f ? 'bold' : 'normal',
              }}
            >
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Aufgaben Liste */}
      <FlatList
        data={filteredTasks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={{ color: theme.textMuted, fontSize: 16 }}>Keine Aufgaben vorhanden.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const priorityColor =
            item.priority === 'Hoch'
              ? theme.priorityHigh
              : item.priority === 'Mittel'
              ? theme.priorityMed
              : theme.priorityLow;

          return (
            <View
              style={[
                styles.taskCard,
                { backgroundColor: theme.cardBg, borderColor: theme.border },
              ]}
            >
              <TouchableOpacity
                style={styles.checkbox}
                onPress={() => toggleTask(item.id)}
              >
                <View
                  style={[
                    styles.checkboxInner,
                    {
                      borderColor: theme.accent,
                      backgroundColor: item.completed ? theme.accent : 'transparent',
                    },
                  ]}
                >
                  {item.completed && <Text style={{ color: '#FFF', fontSize: 10 }}>✓</Text>}
                </View>
              </TouchableOpacity>

              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.taskTitle,
                    { color: theme.text },
                    item.completed && styles.taskCompleted,
                  ]}
                >
                  {item.title}
                </Text>
                <View style={styles.taskMeta}>
                  <View
                    style={[styles.priorityIndicator, { backgroundColor: priorityColor }]}
                  />
                  <Text style={[styles.taskMetaText, { color: theme.textMuted }]}>
                    {item.priority} • {item.createdAt}
                  </Text>
                </View>
              </View>

              <TouchableOpacity onPress={() => deleteTask(item.id)} style={styles.deleteButton}>
                <Text style={{ fontSize: 16 }}>🗑️</Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />

      {/* Einstellungen / Backup Modal */}
      <Modal visible={settingsModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBg }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Einstellungen & Backup</Text>

            {/* Dark Mode Switch */}
            <View style={styles.settingRow}>
              <Text style={{ color: theme.text, fontSize: 16 }}>Dunkles Design</Text>
              <Switch value={isDarkMode} onValueChange={toggleDarkMode} />
            </View>

            <View style={[styles.divider, { backgroundColor: theme.border }]} />

            {/* Backup & Import */}
            <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>DATEN-BACKUP</Text>

            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: theme.accent }]}
              onPress={exportBackup}
            >
              <Text style={styles.modalButtonText}>💾 Backup Exportieren (JSON)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.modalButton,
                { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.border },
              ]}
              onPress={importBackup}
            >
              <Text style={[styles.modalButtonText, { color: theme.text }]}>
                📥 Backup Wiederherstellen
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: theme.border }]}
              onPress={() => setSettingsModalVisible(false)}
            >
              <Text style={{ color: theme.text, fontWeight: 'bold' }}>Schließen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
  },
  headerSubtitle: {
    fontSize: 14,
    marginTop: 2,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  inputCard: {
    marginHorizontal: 20,
    padding: 15,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 15,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  label: {
    fontSize: 13,
    marginRight: 10,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    marginRight: 8,
  },
  addButton: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  addButtonText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 15,
  },
  filterRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  filterTab: {
    paddingVertical: 8,
    paddingHorizontal: 15,
  },
  listContainer: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 40,
  },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  checkbox: {
    marginRight: 12,
  },
  checkboxInner: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  taskCompleted: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  taskMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  priorityIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  taskMetaText: {
    fontSize: 12,
  },
  deleteButton: {
    padding: 5,
    marginLeft: 10,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  divider: {
    height: 1,
    marginVertical: 15,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 12,
  },
  modalButton: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  modalButtonText: {
    color: '#FFF',
    fontWeight: 'bold',
  },
  closeButton: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
  },
});
