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
  console.log('expo-document-picker ist nicht verfügbar.');
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
  TASKS: '@taskmanager_tasks_v26',
  SETTINGS: '@taskmanager_settings_v26',
};

const TASK_CATEGORY = 'task_notification_category';
const ACTION_DONE = 'action_done';
const ACTION_POSTPONE = 'action_postpone';

const UNITS = [
  { label: 'Minuten', value: 'm', multiplier: 1 },
  { label: 'Stunden', value: 'h', multiplier: 60 },
  { label: 'Tage', value: 'd', multiplier: 1440 },
  { label: 'Wochen', value: 'w', multiplier: 10080 },
  { label: 'Monate', value: 'mo', multiplier: 43200 },
];

const calculateReminderMinutes = (valueStr, unitValue) => {
  const val = parseInt(valueStr, 10);
  if (isNaN(val) || val <= 0) return 0;
  const unitObj = UNITS.find((u) => u.value === unitValue);
  const multiplier = unitObj ? unitObj.multiplier : 60;
  return val * multiplier;
};

const formatDDMMYYYY = (input) => {
  const cleaned = input.replace(/\D/g, '').slice(0, 8);
  if (cleaned.length <= 2) return cleaned;
  if (cleaned.length <= 4) return `${cleaned.slice(0, 2)}.${cleaned.slice(2)}`;
  return `${cleaned.slice(0, 2)}.${cleaned.slice(2, 4)}.${cleaned.slice(4)}`;
};

const formatHHMM = (input) => {
  const cleaned = input.replace(/\D/g, '').slice(0, 4);
  if (cleaned.length <= 2) return cleaned;
  return `${cleaned.slice(0, 2)}:${cleaned.slice(2)}`;
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

const isValidTime = (timeStr) => {
  if (!timeStr || timeStr.length !== 5) return false;
  const parts = timeStr.split(':');
  if (parts.length !== 2) return false;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes)) return false;
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
};

const parseDateTime = (dateStr, timeStr) => {
  if (!isValidGermanDate(dateStr)) return null;
  const [day, month, year] = dateStr.split('.').map(Number);
  let hours = 9;
  let minutes = 0;

  if (isValidTime(timeStr)) {
    const tParts = timeStr.split(':').map(Number);
    hours = tParts[0];
    minutes = tParts[1];
  }

  return new Date(year, month - 1, day, hours, minutes, 0);
};

const getTomorrowDateString = (dateStr) => {
  const dateObj = parseDateTime(dateStr, '09:00');
  if (!dateObj) return dateStr;
  dateObj.setDate(dateObj.getDate() + 1);
  const d = String(dateObj.getDate()).padStart(2, '0');
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const y = dateObj.getFullYear();
  return `${d}.${m}.${y}`;
};

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [textInput, setTextInput] = useState('');
  const [priority, setPriority] = useState('Mittel');
  const [dueDateInput, setDueDateInput] = useState('');
  const [dueTimeInput, setDueTimeInput] = useState('');
  
  const [reminderValue, setReminderValue] = useState('');
  const [reminderUnit, setReminderUnit] = useState('h');
  const [unitDropdownVisible, setUnitDropdownVisible] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState('Offen');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [settingsModalVisible, setSettingsModalVisible] = useState(false);
  const [manualModalVisible, setManualModalVisible] = useState(false);

  // Edit State
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState(null);
  const [editText, setEditText] = useState('');
  const [editPriority, setEditPriority] = useState('Mittel');
  const [editDueDateInput, setEditDueDateInput] = useState('');
  const [editDueTimeInput, setEditDueTimeInput] = useState('');
  const [editReminderValue, setEditReminderValue] = useState('');
  const [editReminderUnit, setEditReminderUnit] = useState('h');
  const [editUnitDropdownVisible, setEditUnitDropdownVisible] = useState(false);

  const dueDateInputRef = useRef(null);
  const dueTimeInputRef = useRef(null);
  const reminderInputRef = useRef(null);

  const editDueDateInputRef = useRef(null);
  const editDueTimeInputRef = useRef(null);

  useEffect(() => {
    loadData();
    setupNotifications();
  }, []);

  useEffect(() => {
    saveTasks(tasks);
  }, [tasks]);

  const setupNotifications = async () => {
    if (!Notifications || Platform.OS === 'web') return;

    try {
      const { status } = await Notifications.getPermissionsAsync();
      if (status !== 'granted') {
        await Notifications.requestPermissionsAsync();
      }

      await Notifications.setNotificationCategoryAsync(TASK_CATEGORY, [
        {
          identifier: ACTION_DONE,
          buttonTitle: 'Erledigt ✓',
          options: { opensAppToForeground: false },
        },
        {
          identifier: ACTION_POSTPONE,
          buttonTitle: 'Auf morgen verschieben 📅',
          options: { opensAppToForeground: false },
        },
      ]);
    } catch (err) {
      console.log('Fehler beim Setup der Benachrichtigungen:', err);
    }
  };

  useEffect(() => {
    if (!Notifications || Platform.OS === 'web') return;

    const subscription = Notifications.addNotificationResponseReceivedListener(async (response) => {
      const actionId = response.actionIdentifier;
      const taskId = response.notification.request.content.data?.taskId;

      if (!taskId) return;

      if (actionId === ACTION_DONE) {
        setTasks((prevTasks) =>
          prevTasks.map((t) => {
            if (t.id === taskId) {
              const todayStr = new Date().toLocaleDateString('de-DE');
              return { ...t, completed: true, completedAt: todayStr, notificationId: null };
            }
            return t;
          })
        );
      } else if (actionId === ACTION_POSTPONE) {
        setTasks((prevTasks) =>
          prevTasks.map((t) => {
            if (t.id === taskId && t.dueDate) {
              const newDate = getTomorrowDateString(t.dueDate);
              return { ...t, dueDate: newDate };
            }
            return t;
          })
        );
      }
    });

    return () => subscription.remove();
  }, [tasks]);

  const scheduleTaskNotification = async (task) => {
    if (!Notifications || !task.dueDate || !task.reminderValue) return null;

    try {
      const dueDateObj = parseDateTime(task.dueDate, task.dueTime);
      if (!dueDateObj) return null;

      const offsetMinutes = calculateReminderMinutes(task.reminderValue, task.reminderUnit);
      if (offsetMinutes <= 0) return null;

      const triggerDate = new Date(dueDateObj.getTime() - offsetMinutes * 60 * 1000);
      if (triggerDate.getTime() <= Date.now()) return null;

      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: `⏰ Erinnerung: ${task.title}`,
          body: `Frist fällig am ${task.dueDate}${task.dueTime ? ` um ${task.dueTime}` : ''}!`,
          sound: true,
          categoryIdentifier: TASK_CATEGORY,
          data: { taskId: task.id },
        },
        trigger: triggerDate,
      });

      return notificationId;
    } catch (e) {
      console.log('Fehler beim Planen der Notification:', e);
      return null;
    }
  };

  const cancelTaskNotification = async (notificationId) => {
    if (Notifications && notificationId) {
      try {
        await Notifications.cancelScheduledNotificationAsync(notificationId);
      } catch (e) {
        console.log('Fehler beim Stornieren:', e);
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
      if (isValidGermanDate(formatted)) {
        dueTimeInputRef.current?.focus();
      } else {
        Alert.alert('Ungültiges Datum', 'Bitte gib ein gültiges Kalenderdatum ein.');
        setDueDateInput('');
        dueDateInputRef.current?.focus();
      }
    }
  };

  const handleDueDateBlur = () => {
    if (dueDateInput.length > 0 && !isValidGermanDate(dueDateInput)) {
      Alert.alert('Ungültiges Datum', 'Das eingegebene Datum ist ungültig. Bitte erneut eingeben.');
      setDueDateInput('');
      dueDateInputRef.current?.focus();
    }
  };

  const handleDueTimeChange = (text) => {
    const formatted = formatHHMM(text);
    setDueTimeInput(formatted);

    if (formatted.length === 5) {
      if (isValidTime(formatted)) {
        reminderInputRef.current?.focus();
      } else {
        Alert.alert('Ungültige Uhrzeit', 'Bitte gib eine gültige Uhrzeit ein.');
        setDueTimeInput('');
        dueTimeInputRef.current?.focus();
      }
    }
  };

  const handleDueTimeBlur = () => {
    if (dueTimeInput.length > 0 && !isValidTime(dueTimeInput)) {
      Alert.alert('Ungültige Uhrzeit', 'Die eingegebene Uhrzeit ist ungültig. Bitte erneut eingeben.');
      setDueTimeInput('');
      dueTimeInputRef.current?.focus();
    }
  };

  const handleEditDueDateChange = (text) => {
    const formatted = formatDDMMYYYY(text);
    setEditDueDateInput(formatted);

    if (formatted.length === 10) {
      if (isValidGermanDate(formatted)) {
        editDueTimeInputRef.current?.focus();
      } else {
        Alert.alert('Ungültiges Datum', 'Bitte gib ein gültiges Kalenderdatum ein.');
        setEditDueDateInput('');
        editDueDateInputRef.current?.focus();
      }
    }
  };

  const handleEditDueDateBlur = () => {
    if (editDueDateInput.length > 0 && !isValidGermanDate(editDueDateInput)) {
      Alert.alert('Ungültiges Datum', 'Das Datum ist ungültig. Bitte erneut eingeben.');
      setEditDueDateInput('');
      editDueDateInputRef.current?.focus();
    }
  };

  const handleEditDueTimeChange = (text) => {
    const formatted = formatHHMM(text);
    setEditDueTimeInput(formatted);

    if (formatted.length === 5) {
      if (!isValidTime(formatted)) {
        Alert.alert('Ungültige Uhrzeit', 'Bitte gib eine gültige Uhrzeit ein.');
        setEditDueTimeInput('');
        editDueTimeInputRef.current?.focus();
      }
    }
  };

  const handleEditDueTimeBlur = () => {
    if (editDueTimeInput.length > 0 && !isValidTime(editDueTimeInput)) {
      Alert.alert('Ungültige Uhrzeit', 'Die Uhrzeit ist ungültig. Bitte erneut eingeben.');
      setEditDueTimeInput('');
      editDueTimeInputRef.current?.focus();
    }
  };

  const addTask = async () => {
    if (textInput.trim() === '') {
      Alert.alert('Hinweis', 'Bitte gib eine Aufgabenbeschreibung ein.');
      return;
    }

    if (dueDateInput.length > 0 && !isValidGermanDate(dueDateInput)) {
      Alert.alert('Ungültiges Datum', 'Das Datum ist ungültig und wurde zurückgesetzt.');
      setDueDateInput('');
      dueDateInputRef.current?.focus();
      return;
    }

    if (dueTimeInput.length > 0 && !isValidTime(dueTimeInput)) {
      Alert.alert('Ungültige Uhrzeit', 'Die Uhrzeit ist ungültig und wurde zurückgesetzt.');
      setDueTimeInput('');
      dueTimeInputRef.current?.focus();
      return;
    }

    const newTask = {
      id: Date.now().toString(),
      title: textInput.trim(),
      priority: priority,
      dueDate: dueDateInput.length === 10 ? dueDateInput : null,
      dueTime: dueTimeInput.length === 5 ? dueTimeInput : null,
      reminderValue: reminderValue.trim(),
      reminderUnit: reminderUnit,
      notificationId: null,
      completed: false,
      completedAt: null,
      createdAt: new Date().toLocaleDateString('de-DE'),
    };

    if (newTask.dueDate && newTask.reminderValue) {
      newTask.notificationId = await scheduleTaskNotification(newTask);
    }

    setTasks((prev) => [newTask, ...prev]);
    setTextInput('');
    setDueDateInput('');
    setDueTimeInput('');
    setReminderValue('');
  };

  const startEditTask = (task) => {
    setEditingTaskId(task.id);
    setEditText(task.title);
    setEditPriority(task.priority);
    setEditDueDateInput(task.dueDate || '');
    setEditDueTimeInput(task.dueTime || '');
    setEditReminderValue(task.reminderValue || '');
    setEditReminderUnit(task.reminderUnit || 'h');
    setEditModalVisible(true);
  };

  const saveEditedTask = async () => {
    if (editText.trim() === '') {
      Alert.alert('Hinweis', 'Die Beschreibung darf nicht leer sein.');
      return;
    }

    if (editDueDateInput.length > 0 && !isValidGermanDate(editDueDateInput)) {
      Alert.alert('Ungültiges Datum', 'Das Datum ist ungültig und wurde zurückgesetzt.');
      setEditDueDateInput('');
      editDueDateInputRef.current?.focus();
      return;
    }

    if (editDueTimeInput.length > 0 && !isValidTime(editDueTimeInput)) {
      Alert.alert('Ungültige Uhrzeit', 'Die Uhrzeit ist ungültig und wurde zurückgesetzt.');
      setEditDueTimeInput('');
      editDueTimeInputRef.current?.focus();
      return;
    }

    const targetTask = tasks.find((t) => t.id === editingTaskId);
    if (targetTask?.notificationId) {
      await cancelTaskNotification(targetTask.notificationId);
    }

    const updatedDueDate = editDueDateInput.length === 10 ? editDueDateInput : null;
    const updatedDueTime = editDueTimeInput.length === 5 ? editDueTimeInput : null;

    const tempTask = {
      id: editingTaskId,
      title: editText.trim(),
      dueDate: updatedDueDate,
      dueTime: updatedDueTime,
      reminderValue: editReminderValue.trim(),
      reminderUnit: editReminderUnit,
    };

    let newNotificationId = null;
    if (updatedDueDate && editReminderValue.trim() && !targetTask?.completed) {
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
              dueTime: updatedDueTime,
              reminderValue: editReminderValue.trim(),
              reminderUnit: editReminderUnit,
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
          if (!nextState && task.dueDate && task.reminderValue) {
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

      const dateA = parseDateTime(a.dueDate, a.dueTime);
      const dateB = parseDateTime(b.dueDate, b.dueTime);

      if (dateA && !dateB) return -1;
      if (!dateA && dateB) return 1;
      if (!dateA && !dateB) return 0;

      return dateA - dateB;
    });
  };

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

  const getUnitLabel = (uVal) => {
    const found = UNITS.find((u) => u.value === uVal);
    return found ? found.label : 'Stunden';
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

        {/* Frist- und Uhrzeit-Reihe */}
        <View style={styles.dateTimeRow}>
          <TextInput
            ref={dueDateInputRef}
            style={[styles.dateInput, { color: theme.text, borderColor: theme.border }]}
            placeholder="Datum (DDMMJJJJ)"
            placeholderTextColor={theme.textMuted}
            keyboardType="numeric"
            maxLength={10}
            value={dueDateInput}
            onChangeText={handleDueDateChange}
            onBlur={handleDueDateBlur}
            returnKeyType="next"
            onSubmitEditing={() => dueTimeInputRef.current?.focus()}
          />

          <TextInput
            ref={dueTimeInputRef}
            style={[styles.timeInput, { color: theme.text, borderColor: theme.border }]}
            placeholder="HH:MM"
            placeholderTextColor={theme.textMuted}
            keyboardType="numeric"
            maxLength={5}
            value={dueTimeInput}
            onChangeText={handleDueTimeChange}
            onBlur={handleDueTimeBlur}
            returnKeyType="next"
            onSubmitEditing={() => reminderInputRef.current?.focus()}
          />
        </View>

        {/* Erinnerung vorher */}
        <Text style={[styles.sectionSubtitle, { color: theme.textMuted }]}>Erinnerung vorher:</Text>
        <View style={styles.reminderRow}>
          <TextInput
            ref={reminderInputRef}
            style={[styles.reminderInput, { color: theme.text, borderColor: theme.border }]}
            placeholder=""
            placeholderTextColor={theme.textMuted}
            keyboardType="numeric"
            value={reminderValue}
            onChangeText={setReminderValue}
          />

          <TouchableOpacity
            style={[styles.dropdownButton, { backgroundColor: theme.cardBg, borderColor: theme.border }]}
            onPress={() => setUnitDropdownVisible(true)}
          >
            <Text style={{ color: theme.text, fontSize: 14 }}>{getUnitLabel(reminderUnit)} ▾</Text>
          </TouchableOpacity>
        </View>

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

                <View style={styles.metaColumn}>
                  <View style={styles.metaRow}>
                    <View style={styles.iconPlaceholder}>
                      <View style={[styles.priorityIndicator, { backgroundColor: priorityColor }]} />
                    </View>
                    <Text style={[styles.taskMetaText, { color: theme.textMuted }]}>
                      {item.priority}
                    </Text>
                  </View>

                  {item.dueDate ? (
                    <View style={styles.metaRow}>
                      <View style={styles.iconPlaceholder}>
                        <Text style={{ fontSize: 12 }}>📅</Text>
                      </View>
                      <Text style={[styles.taskMetaText, { color: theme.textMuted }]}>
                        {item.dueDate} {item.dueTime ? `uhr ${item.dueTime}` : ''}
                      </Text>
                    </View>
                  ) : null}

                  {item.dueDate && item.reminderValue ? (
                    <View style={styles.metaRow}>
                      <View style={styles.iconPlaceholder}>
                        <Text style={{ fontSize: 12 }}>🔔</Text>
                      </View>
                      <Text style={[styles.taskMetaText, { color: theme.textMuted }]}>
                        {item.reminderValue} {getUnitLabel(item.reminderUnit)} vorher
                      </Text>
                    </View>
                  ) : null}

                  {item.completed && item.completedAt ? (
                    <View style={styles.metaRow}>
                      <View style={styles.iconPlaceholder}>
                        <Text style={{ fontSize: 11 }}>✓</Text>
                      </View>
                      <Text style={[styles.completedDateText, { color: theme.priorityLow }]}>
                        Erledigt am: {item.completedAt}
                      </Text>
                    </View>
                  ) : null}
                </View>
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

      {/* Modal: Dropdown für Einheit (Hauptformular) */}
      <Modal visible={unitDropdownVisible} transparent={true} animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setUnitDropdownVisible(false)}>
          <View style={[styles.dropdownContent, { backgroundColor: theme.cardBg, borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text, fontSize: 16, marginBottom: 10 }]}>Einheit wählen</Text>
            {UNITS.map((u) => (
              <TouchableOpacity
                key={u.value}
                style={[styles.dropdownItem, { borderBottomColor: theme.border }]}
                onPress={() => {
                  setReminderUnit(u.value);
                  setUnitDropdownVisible(false);
                }}
              >
                <Text style={{ color: theme.text, fontSize: 15 }}>{u.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Modal: Dropdown für Einheit (Bearbeiten-Modus) */}
      <Modal visible={editUnitDropdownVisible} transparent={true} animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setEditUnitDropdownVisible(false)}>
          <View style={[styles.dropdownContent, { backgroundColor: theme.cardBg, borderColor: theme.border }]}>
            <Text style={[styles.modalTitle, { color: theme.text, fontSize: 16, marginBottom: 10 }]}>Einheit wählen</Text>
            {UNITS.map((u) => (
              <TouchableOpacity
                key={u.value}
                style={[styles.dropdownItem, { borderBottomColor: theme.border }]}
                onPress={() => {
                  setEditReminderUnit(u.value);
                  setEditUnitDropdownVisible(false);
                }}
              >
                <Text style={{ color: theme.text, fontSize: 15 }}>{u.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

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

            <View style={styles.dateTimeRow}>
              <TextInput
                ref={editDueDateInputRef}
                style={[styles.dateInput, { color: theme.text, borderColor: theme.border }]}
                value={editDueDateInput}
                onChangeText={handleEditDueDateChange}
                onBlur={handleEditDueDateBlur}
                placeholder="Datum (DDMMJJJJ)"
                placeholderTextColor={theme.textMuted}
                keyboardType="numeric"
                maxLength={10}
              />

              <TextInput
                ref={editDueTimeInputRef}
                style={[styles.timeInput, { color: theme.text, borderColor: theme.border }]}
                value={editDueTimeInput}
                onChangeText={handleEditDueTimeChange}
                onBlur={handleEditDueTimeBlur}
                placeholder="HH:MM"
                placeholderTextColor={theme.textMuted}
                keyboardType="numeric"
                maxLength={5}
              />
            </View>

            <Text style={[styles.sectionSubtitle, { color: theme.textMuted }]}>Erinnerung vorher:</Text>
            <View style={styles.reminderRow}>
              <TextInput
                style={[styles.reminderInput, { color: theme.text, borderColor: theme.border }]}
                value={editReminderValue}
                onChangeText={setEditReminderValue}
                placeholder=""
                placeholderTextColor={theme.textMuted}
                keyboardType="numeric"
              />

              <TouchableOpacity
                style={[styles.dropdownButton, { backgroundColor: theme.cardBg, borderColor: theme.border, flex: 1 }]}
                onPress={() => setEditUnitDropdownVisible(true)}
              >
                <Text style={{ color: theme.text, fontSize: 14 }}>{getUnitLabel(editReminderUnit)} ▾</Text>
              </TouchableOpacity>
            </View>

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

      {/* Modal: Einstellungen / Backup & Entwicklerinfo */}
      <Modal visible={settingsModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBg }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Einstellungen & Info</Text>

            <View style={styles.settingRow}>
              <Text style={{ color: theme.text, fontSize: 16 }}>Dunkles Design</Text>
              <Switch value={isDarkMode} onValueChange={toggleDarkMode} />
            </View>

            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: theme.border, marginTop: 5 }]}
              onPress={() => {
                setSettingsModalVisible(false);
                setManualModalVisible(true);
              }}
            >
              <Text style={[styles.modalButtonText, { color: theme.text }]}>📖 Benutzerhandbuch & Info</Text>
            </TouchableOpacity>

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

      {/* Modal: Benutzerhandbuch & Entwicklerinfo */}
      <Modal visible={manualModalVisible} animationType="slide" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: theme.cardBg, maxHeight: '80%' }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>Benutzerhandbuch</Text>

            <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
              <Text style={[styles.manualHeading, { color: theme.accent }]}>1. Neue Aufgabe erstellen</Text>
              <Text style={[styles.manualText, { color: theme.textMuted }]}>
                • Gib einen Titel ein und tippe auf Weiter.{'\n'}
                • Frist (DDMMJJJJ) und Uhrzeit (HH:MM) eingeben. Nach vollständiger und gültiger Eingabe springt der Cursor automatisch zum nächsten Feld.{'\n'}
                • Sollte ein eingegebenes Datum oder eine Uhrzeit ungültig sein (z. B. Monat 13 oder 88 Minuten), stoppt der automatische Sprung, das betroffene Feld wird geleert und der Fokus springt direkt zur erneuten Eingabe zurück.{'\n'}
                • Wähle Erinnerungszeit & Priorität und tippe auf „Aufgabe Hinzufügen“.
              </Text>

              <Text style={[styles.manualHeading, { color: theme.accent }]}>2. Verwaltung & Benachrichtigungen</Text>
              <Text style={[styles.manualText, { color: theme.textMuted }]}>
                • Per Checkbox erledigen, per Stift bearbeiten oder per Mülleimer löschen.{'\n'}
                • Bei gesetztem Fristdatum erinnert dich die App rechtzeitig per Push-Benachrichtigung.
              </Text>

              <Text style={[styles.manualHeading, { color: theme.accent }]}>3. Backup & Daten</Text>
              <Text style={[styles.manualText, { color: theme.textMuted }]}>
                Über die Einstellungen kannst du jederzeit ein JSON-Backup deiner Daten erstellen oder wiederherstellen.
              </Text>

              <View style={[styles.divider, { backgroundColor: theme.border }]} />

              <Text style={[styles.manualHeading, { color: theme.accent }]}>Entwicklerinformation</Text>
              <Text style={[styles.manualText, { color: theme.text }]}>
                Entwickler: Özgür Cetin{'\n'}
                E-Mail: ozgur.cetin@web.de
              </Text>
            </ScrollView>

            <TouchableOpacity
              style={[styles.closeButton, { backgroundColor: theme.accent, marginTop: 10 }]}
              onPress={() => setManualModalVisible(false)}
            >
              <Text style={{ color: '#FFF', fontWeight: 'bold' }}>Verstanden</Text>
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
  dateTimeRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  dateInput: {
    flex: 2,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 13,
    marginRight: 8,
  },
  timeInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 10,
    fontSize: 13,
    textAlign: 'center',
  },
  sectionSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  reminderInput: {
    width: 80,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 14,
    marginRight: 8,
    textAlign: 'center',
  },
  dropdownButton: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    justifyContent: 'center',
  },
  dropdownContent: {
    width: '80%',
    maxWidth: 300,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    alignSelf: 'center',
    marginTop: 'auto',
    marginBottom: 'auto',
  },
  dropdownItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
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
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  taskCompleted: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  metaColumn: {
    marginTop: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 1.5,
  },
  priorityIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  iconPlaceholder: {
    width: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
  },
  taskMetaText: {
    fontSize: 12,
  },
  completedDateText: {
    fontSize: 11,
    fontWeight: '600',
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
  manualHeading: {
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 10,
    marginBottom: 4,
  },
  manualText: {
    fontSize: 13,
    lineHeight: 18,
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
