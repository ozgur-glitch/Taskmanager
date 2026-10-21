import React, { useState, useEffect, useRef } from 'react';
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
  Modal,
  Switch,
  ScrollView
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

let FileSystem = null;
let DocumentPicker = null;
let Notifications = null;

try {
  FileSystem = require('expo-file-system');
} catch (e) {
  console.log('expo-file-system ist nicht verfügbar.');
}

try {
  DocumentPicker = require('expo-document-picker');
} catch (e) {
  console.log('expo-document-picker ist nicht verfügbar me.');
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
  console.log('expo-notifications ist nicht verfügbar.');
}

const STORAGE_KEYS = {
  TASKS: '@taskmanager_tasks_v7',
  SETTINGS: '@taskmanager_settings_v7',
};

// Vordefinierte Optionen für Push-Mitteilungen (Offset in Minuten)
const NOTIFICATION_OPTIONS = [
  { label: 'Keine', value: null },
  { label: 'Pünktlich (09:00 Uhr)', value: 0 },
  { label: '15 Min. vorher', value: 15 },
  { label: '30 Min. vorher', value: 30 },
  { label: '1 Std. vorher', value: 60 },
  { label: '2 Std. vorher', value: 120 },
  { label: '1 Tag vorher', value: 1440 },
  { label: '2 Tage vorher', value: 2880 },
  { label: '1 Woche vorher', value: 10080 },
];

const formatDDMMYYYY = (input) => {
  const cleaned = input.replace(/\D/g, '').slice(0, 8);
  if (cleaned.length <= 2) return cleaned;
  if (cleaned.length <= 4) return `${cleaned.slice(0, 2)}.${cleaned.slice(2)}`;
  return `${cleaned.slice(0, 2)}.${cleaned.slice(2, 4)}.${cleaned.slice(4)}`;
};

const isValidGermanDate = (dateStr) => {
  if (!dateStr || dateStr.length !== 10) return false;
  const parts = dateStr.split('.');
  if (parts.length !== 3) return false;

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const year = parseInt(parts[2], 10);

  if (isNaN(day) || isNaN(month) || isNaN(year)) return false;
  if (month < 1 || month > 12) return false;
  if (year < 2000 || year > 2100) return false;

  const dateObj = new Date(year, month - 1, day);
  return (
    dateObj.getFullYear() === year &&
    dateObj.getMonth() === month - 1 &&
    dateObj.getDate() === day
  );
};

const parseGermanDate = (dateStr) => {
  if (!isValidGermanDate(dateStr)) return null;
  const [day, month, year] = dateStr.split('.').map(Number);
  return new Date(year, month - 1, day, 9, 0, 0); // Standardmäßig 09:00 Uhr morgens
};

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [textInput, setTextInput] = useState('');
  const [priority, setPriority] = useState('Mittel');
  const [dueDateInput, setDueDateInput] = useState('');
  const [reminderOffset, setReminderOffset] = useState(60); // Standard: 1 Std. vorher

  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState('Offen'); // Standardmäßig Offen
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);

  // Edit State
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editText, setEditText] = useState('');
  const [editPriority, setEditPriority] = useState('Mittel');
  const [editDueDateInput, setEditDueDateInput] = useState('');
  const [editReminderOffset, setEditReminderOffset] = useState(null);

  const dueDateInputRef = useRef(null);

  useEffect(() => {
    loadData();
    requestNotificationPermissions();
  }, []);

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
        console.log('Fehler bei Benachrichtigungsrechten:', err);
      }
    }
  };

  const scheduleTaskNotification = async (task) => {
    if (!Notifications || !task.dueDate || task.reminderOffset === null) return null;

    try {
      const dueDateObj = parseGermanDate(task.dueDate);
      if (!dueDateObj) return null;

      // Abziehen des Offset (in Minuten) vom Fälligkeitsdatum
      const triggerDate = new Date(dueDateObj.getTime() - task.reminderOffset * 60 * 1000);

      // Falls der Zeitpunkt in der Vergangenheit liegt, nicht einplanen
      if (triggerDate.getTime() <= Date.now()) return null;

      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: `⏰ Erinnerung: ${task.title}`,
          body: `Frist läuft ab am ${task.dueDate}!`,
          sound: true,
        },
        trigger: triggerDate,
      });

      return notificationId;
    } catch (e) {
      console.log('Fehler beim Einplanen der Benachrichtigung:', e);
      return null;
    }
  };

  const cancelTaskNotification = async (notificationId) => {
    if (Notifications && notificationId) {
      try {
        await Notifications.cancelScheduledNotificationAsync(notificationId);
      } catch (e) {
        console.log('Fehler beim Stornieren der Benachrichtigung:', e);
      }
    }
  };

  const loadData = async () => {
    try {
      const storedTasks = await AsyncStorage.getItem(STORAGE_KEYS.TASKS);
      const storedSettings = await AsyncStorage.getItem(STORAGE_KEYS.SETTINGS);

      if (storedTasks !== null) setTasks(JSON.parse(storedTasks));
      if (storedSettings !== null) {
        const settings = JSON.parse(storedSettings);
        setIsDarkMode(settings.isDarkMode ?? false);
      }
    } catch (e) {
      Alert.alert('Fehler', 'Daten konnten nicht geladen werden.');
    }
  };

  const saveTasks = async (newTasks) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(newTasks));
    } catch (e) {
      console.log('Fehler beim Speichern:', e);
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
      console.log('Fehler beim Speichern:', e);
    }
  };

  const handleDueDateChange = (text) => {
    const formatted = formatDDMMYYYY(text);
    setDueDateInput(formatted);

    if (formatted.length === 10) {
      triggerAddTask(formatted);
    }
  };

  const triggerAddTask = async (overrideDueDate = null) => {
    const dateToUse = overrideDueDate !== null ? overrideDueDate : dueDateInput;

    if (textInput.trim() === '') {
      Alert.alert('Hinweis', 'Bitte gib eine Aufgabenbeschreibung ein.');
      return;
    }

    if (dateToUse.length > 0 && !isValidGermanDate(dateToUse)) {
      Alert.alert('Ungültiges Datum', 'Bitte gib ein gültiges Kalenderdatum ein (z. B. 25.10.2026).');
      return;
    }

    const newTask = {
      id: Date.now().toString(),
      title: textInput.trim(),
      priority: priority,
      dueDate: dateToUse.length === 10 ? dateToUse : null,
      reminderOffset: reminderOffset,
      notificationId: null,
      completed: false,
      completedAt: null,
      createdAt: new Date().toLocaleDateString('de-DE'),
    };

    if (newTask.dueDate) {
      newTask.notificationId = await scheduleTaskNotification(newTask);
    }

    setTasks((prev) => [newTask, ...prev]);
    setTextInput('');
    setDueDateInput('');
  };

  const addTask = () => {
    triggerAddTask();
  };

  const startEditTask = (task) => {
    setEditingTaskId(task.id);
    setEditText(task.title);
    setEditPriority(task.priority);
    setEditDueDateInput(task.dueDate || '');
    setEditReminderOffset(task.reminderOffset ?? null);
    setEditModalVisible(true);
  };

  const saveEditedTask = async () => {
    if (editText.trim() === '') {
      Alert.alert('Hinweis', 'Die Beschreibung darf nicht leer sein.');
      return;
    }

    if (editDueDateInput.length > 0 && !isValidGermanDate(editDueDateInput)) {
      Alert.alert('Ungültiges Datum', 'Bitte gib ein gültiges Datum ein.');
      return;
    }

    const targetTask = tasks.find((t) => t.id === editingTaskId);
    if (targetTask?.notificationId) {
      await cancelTaskNotification(targetTask.notificationId);
    }

    const updatedDueDate = editDueDateInput.length === 10 ? editDueDateInput : null;
    const tempTask = {
      title: editText.trim(),
      dueDate: updatedDueDate,
      reminderOffset: editReminderOffset,
    };

    let newNotificationId = null;
    if (updatedDueDate && !targetTask?.completed) {
      newNotificationId = await scheduleTaskNotification(tempTask);
    }

    setTasks(
      tasks.map((t) =>
        t.id === editingTaskId
          ? {
              ...t,
              title: editText.trim(),
              priority: editPriority,
              dueDate: updatedDueDate,
              reminderOffset: editReminderOffset,
              notificationId: newNotificationId,
            }
          : t
      )
    );

    setEditModalVisible(false);
    setEditingTaskId(null);
  };

  const toggleTask = async (id) => {
    const todayStr = new Date().toLocaleDateString('de-DE');

    const updatedTasks = await Promise.all(
      tasks.map(async (task) => {
        if (task.id === id) {
          const nextState = !task.completed;

          if (nextState && task.notificationId) {
            await cancelTaskNotification(task.notificationId);
          }

          let newNotificationId = task.notificationId;
          if (!nextState && task.dueDate) {
            newNotificationId = await scheduleTaskNotification(task);
          }

          return {
            ...task,
            completed: nextState,
            completedAt: nextState ? todayStr : null,
            notificationId: nextState ? null : newNotificationId,
          };
        }
        return task;
      })
    );

    setTasks(updatedTasks);
  };

  const deleteTask = async (id) => {
    const taskToDelete = tasks.find((t) => t.id === id);
    if (taskToDelete?.notificationId) {
      await cancelTaskNotification(taskToDelete.notificationId);
    }

    Alert.alert('Löschen', 'Möchtest du diese Aufgabe wirklich löschen?', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: () => setTasks(tasks.filter((task) => task.id !== id)),
      },
    ]);
  };

  const getSortedTasks = () => {
    return [...tasks].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;

      const dateA = parseGermanDate(a.dueDate);
      const dateB = parseGermanDate(b.dueDate);

      if (dateA && !dateB) return -1;
      if (!dateA && dateB) return 1;
      if (!dateA && !dateB) return 0;

      return dateA - dateB;
    });
  };

  // Backup & Import
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
          Alert.alert('Erfolg', 'Backup gespeichert!');
        }
      } else if (FileSystem && FileSystem.documentDirectory) {
        const fileUri = `${FileSystem.documentDirectory}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, jsonString, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        Alert.alert('Backup Erstellt', `Gespeichert unter:\n${fileUri}`);
      } else {
        await Share.share({ message: jsonString, title: fileName });
      }
    } catch (err) {
      Alert.alert('Export Fehler', err.message);
    }
  };

  const importBackup = async () => {
    if (!DocumentPicker) {
      Alert.alert('Fehler', 'Document Picker nicht verfügbar.');
      return;
    }

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      const fileUri = result.assets[0].uri;
      let content = '';

      if (FileSystem) {
        content = await FileSystem.readAsStringAsync(fileUri, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      }

      const parsedData = JSON.parse(content);

      Alert.alert(
        'Wiederherstellung',
        'Möchtest du alle Daten überschreiben?',
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
              Alert.alert('Erfolg', 'Daten wiederhergestellt!');
            },
          },
        ]
      );
    } catch (err) {
      Alert.alert('Import Fehler', err.message);
    }
  };

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

  const filteredTasks = getSortedTasks().filter((task) => {
    if (filter === 'Offen' && task.completed) return false;
    if (filter === 'Erledigt' && !task.completed) return false;

    if (searchQuery.trim() !== '') {
      const query = searchQuery.toLowerCase();
      const matchTitle = task.title.toLowerCase().includes(query);
      const matchPriority = task.priority.toLowerCase().includes(query);
      const matchDueDate = task.dueDate ? task.dueDate.includes(query) : false;

      return matchTitle || matchPriority || matchDueDate;
    }

    return true;
  });

  const getReminderLabel = (val) => {
    const opt = NOTIFICATION_OPTIONS.find((o) => o.value === val);
    return opt ? opt.label : 'Keine';
  };

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
          returnKeyType="next"
          onSubmitEditing={() => dueDateInputRef.current?.focus()}
        />

        <TextInput
          ref={dueDateInputRef}
          style={[styles.input, { color: theme.text, borderColor: theme.border }]}
          placeholder="Frist (DDMMJJJJ, z. B. 25102026)"
          placeholderTextColor={theme.textMuted}
          keyboardType="numeric"
          maxLength={10}
          value={dueDateInput}
          onChangeText={handleDueDateChange}
          returnKeyType="done"
          onSubmitEditing={addTask}
        />

        {/* Erinnerungsauswahl (Horizontaler Slider) */}
        <Text style={[styles.sectionSubtitle, { color: theme.textMuted }]}>Erinnerung (Push):</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
          {NOTIFICATION_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.label}
              style={[
                styles.badge,
                {
                  backgroundColor: reminderOffset === opt.value ? theme.accent : 'transparent',
                  borderColor: theme.border,
                },
              ]}
              onPress={() => setReminderOffset(opt.value)}
            >
              <Text
                style={{
                  color: reminderOffset === opt.value ? '#FFF' : theme.textMuted,
                  fontSize: 11,
                  fontWeight: '600',
                }}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

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

      {/* Suchleiste */}
      <View style={[styles.searchContainer, { backgroundColor: theme.cardBg, borderColor: theme.border }]}>
        <Text style={{ fontSize: 16, marginRight: 8 }}>🔍</Text>
        <TextInput
          style={[styles.searchInput, { color: theme.text }]}
          placeholder="Aufgabe, Frist oder Priorität suchen..."
          placeholderTextColor={theme.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearSearchButton}>
            <Text style={{ fontSize: 14, color: theme.textMuted }}>❌</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Filter Tabs */}
      <View style={styles.filterRow}>
        {['Offen', 'Alle', 'Erledigt'].map((f) => (
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
            <Text style={{ color: theme.textMuted, fontSize: 16 }}>Keine Aufgaben gefunden.</Text>
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
              <TouchableOpacity style={styles.checkbox} onPress={() => toggleTask(item.id)}>
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
                  <View style={[styles.priorityIndicator, { backgroundColor: priorityColor }]} />
                  <Text style={[styles.taskMetaText, { color: theme.textMuted }]}>
                    {item.priority}
                    {item.dueDate ? ` • 📅 ${item.dueDate}` : ''}
                    {item.dueDate && item.reminderOffset !== null
                      ? ` • 🔔 ${getReminderLabel(item.reminderOffset)}`
                      : ''}
                  </Text>
                </View>

                {item.completed && item.completedAt && (
                  <Text style={[styles.completedDateText, { color: theme.priorityLow }]}>
                    ✓ Erledigt am: {item.completedAt}
                  </Text>
                )}
              </View>

              <TouchableOpacity onPress={() => startEditTask(item)} style={styles.actionButton}>
                <Text style={{ fontSize: 16 }}>✏️</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={() => deleteTask(item.id)} style={styles.actionButton}>
                <Text style={{ fontSize: 16 }}>🗑️</Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />

      {/* Modal: Aufgabe Bearbeiten */}
      <Modal visible={editModalVisible} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBg }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Aufgabe Bearbeiten</Text>

            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              value={editText}
              onChangeText={setEditText}
              placeholder="Aufgabenbeschreibung"
              placeholderTextColor={theme.textMuted}
            />

            <TextInput
              style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              value={editDueDateInput}
              onChangeText={(text) => setEditDueDateInput(formatDDMMYYYY(text))}
              placeholder="Frist (DDMMJJJJ)"
              placeholderTextColor={theme.textMuted}
              keyboardType="numeric"
              maxLength={10}
            />

            <Text style={[styles.sectionSubtitle, { color: theme.textMuted }]}>Erinnerung (Push):</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
              {NOTIFICATION_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.label}
                  style={[
                    styles.badge,
                    {
                      backgroundColor: editReminderOffset === opt.value ? theme.accent : 'transparent',
                      borderColor: theme.border,
                    },
                  ]}
                  onPress={() => setEditReminderOffset(opt.value)}
                >
                  <Text
                    style={{
                      color: editReminderOffset === opt.value ? '#FFF' : theme.textMuted,
                      fontSize: 11,
                      fontWeight: '600',
                    }}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.row}>
              <Text style={[styles.label, { color: theme.textMuted }]}>Priorität:</Text>
              {['Niedrig', 'Mittel', 'Hoch'].map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.badge,
                    {
                      backgroundColor: editPriority === p ? theme.accent : 'transparent',
                      borderColor: theme.border,
                    },
                  ]}
                  onPress={() => setEditPriority(p)}
                >
                  <Text
                    style={{
                      color: editPriority === p ? '#FFF' : theme.textMuted,
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
              style={[styles.modalButton, { backgroundColor: theme.accent, marginTop: 10 }]}
              onPress={saveEditedTask}
            >
              <Text style={styles.modalButtonText}>Speichern</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: theme.border }]}
              onPress={() => setEditModalVisible(false)}
            >
              <Text style={{ color: theme.text, fontWeight: 'bold' }}>Abbrechen</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal: Einstellungen / Backup */}
      <Modal visible={settingsModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBg }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Einstellungen & Backup</Text>

            <View style={styles.settingRow}>
              <Text style={{ color: theme.text, fontSize: 16 }}>Dunkles Design</Text>
              <Switch value={isDarkMode} onValueChange={toggleDarkMode} />
            </View>

            <View style={[styles.divider, { backgroundColor: theme.border }]} />

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
    marginBottom: 10,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 10,
  },
  sectionSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 2,
  },
  clearSearchButton: {
    padding: 4,
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
  completedDateText: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 3,
  },
  actionButton: {
    padding: 5,
    marginLeft: 6,
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
