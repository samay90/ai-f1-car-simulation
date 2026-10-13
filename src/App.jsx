import React from 'react'
import Track from './Components/Track'
import { getTrack } from '../utils/getTrack'
const App = () => {
  const [track, setTrack] = React.useState(null)
  
  React.useEffect(() => {
    setTrack(getTrack())
  },[])
  return (
    <>
    {track && <Track track={track} />}
    </>
  )
}

export default App