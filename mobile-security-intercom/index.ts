import 'react-native-gesture-handler';
// Defines the background location task at start-up, so Android can run it with the app closed.
import '@/tracking/guardTracking';
import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
