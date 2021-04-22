import { senators } from '../data/senators.js'
import { representatives } from '../data/representatives.js'

const congressGrid = document.querySelector('.congressGrid')
const senioritySort = document.querySelector('#senioritySort')
const birthdaySort = document.querySelector('#birthdaySort')

function populateCongressGrid(simplifiedList) {
    console.log(simplifiedList)
    simplifiedList.forEach(person => {
        let personDiv = document.createElement('div')
        let personFig = document.createElement('figure')
        let figImage = document.createElement('img')
        let figCaption = document.createElement('figcaption')

        figImage.src= person.imgURL
        figCaption.textContent = person.name

        personFig.appendChild(figImage)
        personFig.appendChild(figCaption)
        personDiv.appendChild(personFig)
        congressGrid.appendChild(personDiv)
    });
}

function getSimplifiedPeople(peopleList) {
    return peopleList.map(person => {
        let middleName = person.middle_name ? ` ${person.middle_name}` : ``
        return {
            id: person.id,
            name: `${person.first_name} ${middleName} ${person.last_name}`,
            imgURL: `https://www.govtrack.us/static/legislator-photos/${person.govtrack_id}-200px.jpeg`
        }
    })
}

populateCongressGrid(getSimplifiedPeople(representatives))


