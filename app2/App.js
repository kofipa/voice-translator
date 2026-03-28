import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from './screens/HomeScreen';
import FaceToFaceScreen from './screens/FaceToFaceScreen';
import PhraseLookupScreen from './screens/PhraseLookupScreen';
import CallScreen from './screens/CallScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#0f0f0f' },
          headerTintColor: '#fff',
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: '#0f0f0f' },
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
        <Stack.Screen name="FaceToFace" component={FaceToFaceScreen} options={{ title: 'Face-to-Face' }} />
        <Stack.Screen name="PhraseLookup" component={PhraseLookupScreen} options={{ title: 'Phrase Lookup' }} />
        <Stack.Screen name="Call" component={CallScreen} options={{ title: 'Translated Call' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
