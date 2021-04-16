import { starships } from '../data/starships.js'
import { removeChildren, getLastNumber } from '../utils/index.js'

const main = document.querySelector('main')
const navList = document.querySelector('.navList')
const shipView = document.querySelector('.shipView')

function populateNav() {
    starships.forEach((starship) => {
        let anchorWrap = document.createElement('a')
        anchorWrap.href = '#'
        anchorWrap.addEventListener('click', () => populateShipView(starship))
            let listItem = document.createElement('li')
            listItem.textContent = starship.name

            anchorWrap.appendChild(listItem)
            navList.appendChild(anchorWrap)
    })
}

function populateShipView(shipData) {
    removeChildren(shipView)
    let shipImage = document.createElement('img') 
    let shipNum = getLastNumber(shipData.url)
    shipImage.src = `https://starwars-visualguide.com/assets/img/starships/${shipNum}.jpg`
    shipImage.addEventListener('error', () => {
        console.log('Oops! Ship in Garage!')
        shipImage.hidden= true
    })
    shipView.appendChild(shipImage)
}

populateNav()

function addStarField(element, numStars) {
    element.style.setProperty('background-color', 'black')
}

addStarField(document.querySelector('body', 1000))